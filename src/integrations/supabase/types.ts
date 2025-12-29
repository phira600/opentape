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
      api_key_ip_whitelist: {
        Row: {
          api_key_id: string
          created_at: string
          description: string | null
          id: string
          ip_address: string
        }
        Insert: {
          api_key_id: string
          created_at?: string
          description?: string | null
          id?: string
          ip_address: string
        }
        Update: {
          api_key_id?: string
          created_at?: string
          description?: string | null
          id?: string
          ip_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_key_ip_whitelist_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
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
      candles_1min: {
        Row: {
          bucket: string
          close: number | null
          currency: string
          high: number | null
          low: number | null
          open: number | null
          symbol: string
          trade_count: number | null
          volume: number | null
        }
        Insert: {
          bucket: string
          close?: number | null
          currency: string
          high?: number | null
          low?: number | null
          open?: number | null
          symbol: string
          trade_count?: number | null
          volume?: number | null
        }
        Update: {
          bucket?: string
          close?: number | null
          currency?: string
          high?: number | null
          low?: number | null
          open?: number | null
          symbol?: string
          trade_count?: number | null
          volume?: number | null
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
          retention_days: number | null
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
          retention_days?: number | null
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
          retention_days?: number | null
          schedule?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_stats: {
        Row: {
          date: string
          last_updated: string
          total_trades: number
          unique_symbols: number
          unique_venues: number
        }
        Insert: {
          date: string
          last_updated?: string
          total_trades?: number
          unique_symbols?: number
          unique_venues?: number
        }
        Update: {
          date?: string
          last_updated?: string
          total_trades?: number
          unique_symbols?: number
          unique_venues?: number
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          token: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          token?: string
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
          run_days: string[] | null
          run_end_hour: number | null
          run_start_hour: number | null
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
          run_days?: string[] | null
          run_end_hour?: number | null
          run_start_hour?: number | null
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
          run_days?: string[] | null
          run_end_hour?: number | null
          run_start_hour?: number | null
          source_type?: string
          source_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      mv_refresh_log: {
        Row: {
          id: string
          last_trade_id: string | null
          refresh_duration_ms: number | null
          refreshed_at: string
          rows_count: number | null
          view_name: string
        }
        Insert: {
          id?: string
          last_trade_id?: string | null
          refresh_duration_ms?: number | null
          refreshed_at?: string
          rows_count?: number | null
          view_name: string
        }
        Update: {
          id?: string
          last_trade_id?: string | null
          refresh_duration_ms?: number | null
          refreshed_at?: string
          rows_count?: number | null
          view_name?: string
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
          currency: string | null
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
          currency?: string | null
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
          currency?: string | null
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
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_trades:
        | { Args: never; Returns: number }
        | { Args: { retention_days?: number }; Returns: number }
      get_chart_data: {
        Args: {
          p_currency?: string
          p_end_time?: string
          p_start_time?: string
          p_symbol: string
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      refresh_candles: { Args: never; Returns: undefined }
      schedule_cron_job: {
        Args: { job_command: string; job_name: string; job_schedule: string }
        Returns: undefined
      }
      unschedule_cron_job: { Args: { job_name: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
