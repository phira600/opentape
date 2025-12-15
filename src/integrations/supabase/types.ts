export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          created_at: string
          details: Json | null
          id: string
          job_id: string | null
          log_type: string
          message: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: string
          job_id?: string | null
          log_type: string
          message: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: string
          job_id?: string | null
          log_type?: string
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_configurations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          key_hash: string
          last_used_at: string | null
          name: string
          prefix: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_hash: string
          last_used_at?: string | null
          name: string
          prefix: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          key_hash?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          user_id?: string | null
        }
        Relationships: []
      }
      cron_job_configurations: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          name: string
          schedule: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id: string
          is_enabled?: boolean
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          name: string
          schedule?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          name?: string
          schedule?: string
          updated_at?: string
        }
        Relationships: []
      }
      job_configurations: {
        Row: {
          created_at: string
          fetch_interval_seconds: number
          id: string
          is_enabled: boolean
          last_error: string | null
          last_run_at: string | null
          last_status: string | null
          name: string
          source_type: string
          source_url: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fetch_interval_seconds?: number
          id?: string
          is_enabled?: boolean
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          name: string
          source_type: string
          source_url: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fetch_interval_seconds?: number
          id?: string
          is_enabled?: boolean
          last_error?: string | null
          last_run_at?: string | null
          last_status?: string | null
          name?: string
          source_type?: string
          source_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      processed_files: {
        Row: {
          file_hash: string
          file_name: string
          id: string
          job_id: string
          processed_at: string
          records_count: number
        }
        Insert: {
          file_hash: string
          file_name: string
          id?: string
          job_id: string
          processed_at?: string
          records_count?: number
        }
        Update: {
          file_hash?: string
          file_name?: string
          id?: string
          job_id?: string
          processed_at?: string
          records_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "processed_files_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_configurations"
            referencedColumns: ["id"]
          },
        ]
      }
      symbology: {
        Row: {
          created_at: string
          currency: string | null
          id: string
          isin: string | null
          mic: string | null
          name: string | null
          raw_data: Json | null
          segment: string | null
          source: string
          symbol: string
          tick_table: string | null
          updated_at: string
          venue: string
        }
        Insert: {
          created_at?: string
          currency?: string | null
          id?: string
          isin?: string | null
          mic?: string | null
          name?: string | null
          raw_data?: Json | null
          segment?: string | null
          source: string
          symbol: string
          tick_table?: string | null
          updated_at?: string
          venue: string
        }
        Update: {
          created_at?: string
          currency?: string | null
          id?: string
          isin?: string | null
          mic?: string | null
          name?: string | null
          raw_data?: Json | null
          segment?: string | null
          source?: string
          symbol?: string
          tick_table?: string | null
          updated_at?: string
          venue?: string
        }
        Relationships: []
      }
      trades_normalized: {
        Row: {
          created_at: string
          id: string
          job_id: string | null
          market_mechanism: string | null
          price: number
          quantity: number
          raw_data: Json | null
          symbol: string
          trade_time: string
          trading_mode: string | null
          transaction_id: string | null
          venue: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id?: string | null
          market_mechanism?: string | null
          price: number
          quantity: number
          raw_data?: Json | null
          symbol: string
          trade_time: string
          trading_mode?: string | null
          transaction_id?: string | null
          venue: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string | null
          market_mechanism?: string | null
          price?: number
          quantity?: number
          raw_data?: Json | null
          symbol?: string
          trade_time?: string
          trading_mode?: string | null
          transaction_id?: string | null
          venue?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_normalized_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_configurations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      candles_1min: {
        Row: {
          bucket: string | null
          close: number | null
          high: number | null
          low: number | null
          open: number | null
          symbol: string | null
          trade_count: number | null
          venue: string | null
          volume: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      cleanup_old_trades: { Args: never; Returns: number }
      get_chart_data: {
        Args: {
          p_end_time?: string
          p_start_time?: string
          p_symbol: string
          p_venue?: string
        }
        Returns: {
          bucket: string
          close: number
          high: number
          low: number
          open: number
          volume: number
        }[]
      }
      get_latest_prices: {
        Args: never
        Returns: {
          trade_price: number
          trade_symbol: string
          trade_timestamp: string
          trade_venue: string
        }[]
      }
      refresh_candles: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
