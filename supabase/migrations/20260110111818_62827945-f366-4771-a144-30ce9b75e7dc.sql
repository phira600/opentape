-- Step 1: Add timestamp tracking columns to candles_1min
ALTER TABLE candles_1min 
ADD COLUMN IF NOT EXISTS first_trade_ts TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_trade_ts TIMESTAMPTZ;

-- Step 2: Backfill existing candles with bucket as default (approximation)
UPDATE candles_1min 
SET first_trade_ts = bucket, 
    last_trade_ts = bucket + INTERVAL '59 seconds'
WHERE first_trade_ts IS NULL;

-- Step 3: Make columns NOT NULL after backfill
ALTER TABLE candles_1min 
ALTER COLUMN first_trade_ts SET NOT NULL,
ALTER COLUMN last_trade_ts SET NOT NULL;

-- Step 4: Create the candle update function with timestamp tracking
CREATE OR REPLACE FUNCTION update_candle_on_trade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  bucket_time TIMESTAMPTZ;
  trade_currency TEXT;
BEGIN
  -- Calculate the 1-minute bucket (floor to minute)
  bucket_time := date_trunc('minute', NEW.trade_time);
  
  -- Use trade currency, fallback to SEK
  trade_currency := COALESCE(NEW.currency, 'SEK');
  
  -- Upsert the candle with proper timestamp tracking
  INSERT INTO candles_1min (
    symbol, currency, bucket, 
    open, high, low, close, 
    volume, trade_count,
    first_trade_ts, last_trade_ts
  )
  VALUES (
    NEW.symbol, trade_currency, bucket_time,
    NEW.price, NEW.price, NEW.price, NEW.price,
    NEW.quantity, 1,
    NEW.trade_time, NEW.trade_time
  )
  ON CONFLICT (symbol, currency, bucket) DO UPDATE SET
    -- Update open only if this trade is earlier than the current first trade
    open = CASE 
      WHEN NEW.trade_time < candles_1min.first_trade_ts 
      THEN NEW.price 
      ELSE candles_1min.open 
    END,
    -- Update first_trade_ts if this trade is earlier
    first_trade_ts = CASE 
      WHEN NEW.trade_time < candles_1min.first_trade_ts 
      THEN NEW.trade_time 
      ELSE candles_1min.first_trade_ts 
    END,
    -- Update close only if this trade is later than the current last trade
    close = CASE 
      WHEN NEW.trade_time > candles_1min.last_trade_ts 
      THEN NEW.price 
      ELSE candles_1min.close 
    END,
    -- Update last_trade_ts if this trade is later
    last_trade_ts = CASE 
      WHEN NEW.trade_time > candles_1min.last_trade_ts 
      THEN NEW.trade_time 
      ELSE candles_1min.last_trade_ts 
    END,
    -- Always update high/low/volume/count
    high = GREATEST(candles_1min.high, NEW.price),
    low = LEAST(candles_1min.low, NEW.price),
    volume = candles_1min.volume + NEW.quantity,
    trade_count = candles_1min.trade_count + 1;
  
  RETURN NEW;
END;
$$;

-- Step 5: Create the trigger on trades_normalized
CREATE TRIGGER tr_update_candle_on_trade
AFTER INSERT ON trades_normalized
FOR EACH ROW
EXECUTE FUNCTION update_candle_on_trade();

-- Step 6: Disable the refresh-candles cron job
UPDATE cron_job_configurations 
SET is_enabled = false 
WHERE id = 'refresh-candles';