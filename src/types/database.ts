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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      games: {
        Row: {
          away_score: number | null
          away_team: string
          created_at: string
          external_id: string
          home_score: number | null
          home_team: string
          id: string
          in_pool: boolean
          kickoff_time: string
          last_synced_at: string | null
          manual_resolved: boolean
          resolution_mode: string
          sport: string
          status: string
          week_id: number
          winner: string | null
        }
        Insert: {
          away_score?: number | null
          away_team: string
          created_at?: string
          external_id: string
          home_score?: number | null
          home_team: string
          id?: string
          in_pool?: boolean
          kickoff_time: string
          last_synced_at?: string | null
          manual_resolved?: boolean
          resolution_mode?: string
          sport: string
          status?: string
          week_id: number
          winner?: string | null
        }
        Update: {
          away_score?: number | null
          away_team?: string
          created_at?: string
          external_id?: string
          home_score?: number | null
          home_team?: string
          id?: string
          in_pool?: boolean
          kickoff_time?: string
          last_synced_at?: string | null
          manual_resolved?: boolean
          resolution_mode?: string
          sport?: string
          status?: string
          week_id?: number
          winner?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "games_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_picks: {
        Row: {
          bet_text: string
          created_at: string
          display_name: string
          id: string
          is_lotw: boolean
          member_id: string | null
          result: string | null
          season_year: number
          week_number: number
        }
        Insert: {
          bet_text: string
          created_at?: string
          display_name: string
          id?: string
          is_lotw?: boolean
          member_id?: string | null
          result?: string | null
          season_year: number
          week_number: number
        }
        Update: {
          bet_text?: string
          created_at?: string
          display_name?: string
          id?: string
          is_lotw?: boolean
          member_id?: string | null
          result?: string | null
          season_year?: number
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "historical_picks_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pick_audit_log: {
        Row: {
          changed_at: string
          changed_by: string
          id: string
          new_team: string
          pick_id: string
          previous_team: string
        }
        Insert: {
          changed_at?: string
          changed_by: string
          id?: string
          new_team: string
          pick_id: string
          previous_team: string
        }
        Update: {
          changed_at?: string
          changed_by?: string
          id?: string
          new_team?: string
          pick_id?: string
          previous_team?: string
        }
        Relationships: [
          {
            foreignKeyName: "pick_audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pick_audit_log_pick_id_fkey"
            columns: ["pick_id"]
            isOneToOne: false
            referencedRelation: "picks"
            referencedColumns: ["id"]
          },
        ]
      }
      picks: {
        Row: {
          created_at: string
          game_id: string
          id: string
          is_lotw: boolean
          member_id: string
          overridden_at: string | null
          overridden_by: string | null
          picked_team: string
          points: number | null
          updated_at: string
          week_id: number
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          is_lotw?: boolean
          member_id: string
          overridden_at?: string | null
          overridden_by?: string | null
          picked_team: string
          points?: number | null
          updated_at?: string
          week_id: number
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          is_lotw?: boolean
          member_id?: string
          overridden_at?: string | null
          overridden_by?: string | null
          picked_team?: string
          points?: number | null
          updated_at?: string
          week_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "picks_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_overridden_by_fkey"
            columns: ["overridden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          role: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
          is_active?: boolean
          role?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          role?: string
        }
        Relationships: []
      }
      seasons: {
        Row: {
          created_at: string
          id: number
          is_active: boolean
          name: string
          year: number
        }
        Insert: {
          created_at?: string
          id?: number
          is_active?: boolean
          name: string
          year: number
        }
        Update: {
          created_at?: string
          id?: number
          is_active?: boolean
          name?: string
          year?: number
        }
        Relationships: []
      }
      teams: {
        Row: {
          abbreviation: string | null
          created_at: string
          external_id: string | null
          id: number
          name: string
          sport: string
        }
        Insert: {
          abbreviation?: string | null
          created_at?: string
          external_id?: string | null
          id?: number
          name: string
          sport: string
        }
        Update: {
          abbreviation?: string | null
          created_at?: string
          external_id?: string | null
          id?: number
          name?: string
          sport?: string
        }
        Relationships: []
      }
      weekly_scores: {
        Row: {
          forfeit_penalty: number
          id: string
          lotw_penalty: number
          member_id: string
          pick_points: number
          total: number | null
          week_id: number
        }
        Insert: {
          forfeit_penalty?: number
          id?: string
          lotw_penalty?: number
          member_id: string
          pick_points?: number
          total?: number | null
          week_id: number
        }
        Update: {
          forfeit_penalty?: number
          id?: string
          lotw_penalty?: number
          member_id?: string
          pick_points?: number
          total?: number | null
          week_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "weekly_scores_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_scores_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      weeks: {
        Row: {
          auto_close_at: string | null
          close_mode: string
          closes_at: string
          id: number
          opens_at: string
          required_cfb_picks: number | null
          required_nfl_picks: number | null
          required_picks: number
          season_id: number
          status: string
          week_number: number
        }
        Insert: {
          auto_close_at?: string | null
          close_mode?: string
          closes_at: string
          id?: number
          opens_at: string
          required_cfb_picks?: number | null
          required_nfl_picks?: number | null
          required_picks: number
          season_id: number
          status?: string
          week_number: number
        }
        Update: {
          auto_close_at?: string | null
          close_mode?: string
          closes_at?: string
          id?: number
          opens_at?: string
          required_cfb_picks?: number | null
          required_nfl_picks?: number | null
          required_picks?: number
          season_id?: number
          status?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "weeks_season_id_fkey"
            columns: ["season_id"]
            isOneToOne: false
            referencedRelation: "seasons"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      close_week: { Args: { p_week_id: number }; Returns: undefined }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      resolve_game: {
        Args: { p_game_id: string; p_winner: string }
        Returns: undefined
      }
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
