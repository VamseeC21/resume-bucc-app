
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
    PostgrestVersion: "14.1"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      applications: {
        Row: {
          act_score: string | null
          additional_info: string | null
          applicant_email: string
          applicant_name: string
          candidate_number: number | null
          college_of_primary_major: string | null
          expected_graduation_year: string | null
          first_name: string
          first_time_applying: string | null
          game_id: string
          gender: string | null
          gpa: string | null
          how_did_you_hear: string | null
          id: string
          last_name: string | null
          major: string | null
          military_affiliated: string | null
          minor: string | null
          profile_picture_path: string | null
          resume_id: string | null
          sat_score: string | null
          status: string
          submitted_at: string
          video_question_2_choice: string | null
          video_youtube_url: string
          year: string
        }
        Insert: {
          act_score?: string | null
          additional_info?: string | null
          applicant_email: string
          applicant_name: string
          candidate_number?: number | null
          college_of_primary_major?: string | null
          expected_graduation_year?: string | null
          first_name: string
          first_time_applying?: string | null
          game_id: string
          gender?: string | null
          gpa?: string | null
          how_did_you_hear?: string | null
          id?: string
          last_name?: string | null
          major?: string | null
          military_affiliated?: string | null
          minor?: string | null
          profile_picture_path?: string | null
          resume_id?: string | null
          sat_score?: string | null
          status?: string
          submitted_at?: string
          video_question_2_choice?: string | null
          video_youtube_url: string
          year: string
        }
        Update: {
          act_score?: string | null
          additional_info?: string | null
          applicant_email?: string
          applicant_name?: string
          candidate_number?: number | null
          college_of_primary_major?: string | null
          expected_graduation_year?: string | null
          first_name?: string
          first_time_applying?: string | null
          game_id?: string
          gender?: string | null
          gpa?: string | null
          how_did_you_hear?: string | null
          id?: string
          last_name?: string | null
          major?: string | null
          military_affiliated?: string | null
          minor?: string | null
          profile_picture_path?: string | null
          resume_id?: string | null
          sat_score?: string | null
          status?: string
          submitted_at?: string
          video_question_2_choice?: string | null
          video_youtube_url?: string
          year?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      comparisons: {
        Row: {
          created_at: string
          game_id: string
          id: string
          pair_hash: string
          resume_a_id: string
          resume_b_id: string
          user_id: string
          winner_id: string
        }
        Insert: {
          created_at?: string
          game_id: string
          id?: string
          pair_hash: string
          resume_a_id: string
          resume_b_id: string
          user_id: string
          winner_id: string
        }
        Update: {
          created_at?: string
          game_id?: string
          id?: string
          pair_hash?: string
          resume_a_id?: string
          resume_b_id?: string
          user_id?: string
          winner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comparisons_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comparisons_resume_a_id_fkey"
            columns: ["resume_a_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comparisons_resume_b_id_fkey"
            columns: ["resume_b_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comparisons_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      elo_ratings: {
        Row: {
          games: number
          rating: number
          resume_id: string
          updated_at: string
        }
        Insert: {
          games?: number
          rating?: number
          resume_id: string
          updated_at?: string
        }
        Update: {
          games?: number
          rating?: number
          resume_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "elo_ratings_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: true
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      game_members: {
        Row: {
          game_id: string
          joined_at: string
          user_id: string
        }
        Insert: {
          game_id: string
          joined_at?: string
          user_id: string
        }
        Update: {
          game_id?: string
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_members_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          access_token: string
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      interview_scores: {
        Row: {
          application_id: string
          availability: Json
          candidate_phone: string | null
          co_interviewer_name: string | null
          game_id: string
          glaring_concerns: string | null
          id: string
          interviewer_id: string
          overall_impression: string | null
          presentation_path: string | null
          recommendation: string | null
          room_label: string | null
          round: string
          section_scores: Json
          section_totals: Json
          submitted_at: string
          total_score: number
        }
        Insert: {
          application_id: string
          availability?: Json
          candidate_phone?: string | null
          co_interviewer_name?: string | null
          game_id: string
          glaring_concerns?: string | null
          id?: string
          interviewer_id: string
          overall_impression?: string | null
          presentation_path?: string | null
          recommendation?: string | null
          room_label?: string | null
          round: string
          section_scores?: Json
          section_totals?: Json
          submitted_at?: string
          total_score: number
        }
        Update: {
          application_id?: string
          availability?: Json
          candidate_phone?: string | null
          co_interviewer_name?: string | null
          game_id?: string
          glaring_concerns?: string | null
          id?: string
          interviewer_id?: string
          overall_impression?: string | null
          presentation_path?: string | null
          recommendation?: string | null
          room_label?: string | null
          round?: string
          section_scores?: Json
          section_totals?: Json
          submitted_at?: string
          total_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "interview_scores_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_scores_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          first_name: string | null
          id: string
          last_name: string | null
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          first_name?: string | null
          id: string
          last_name?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      resumes: {
        Row: {
          active: boolean
          application_id: string | null
          created_at: string
          game_id: string
          grade: string | null
          id: string
          name: string
          pdf_path: string
        }
        Insert: {
          active?: boolean
          application_id?: string | null
          created_at?: string
          game_id: string
          grade?: string | null
          id?: string
          name: string
          pdf_path: string
        }
        Update: {
          active?: boolean
          application_id?: string | null
          created_at?: string
          game_id?: string
          grade?: string | null
          id?: string
          name?: string
          pdf_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "resumes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resumes_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      round_candidates: {
        Row: {
          application_id: string
          color: string | null
          game_id: string
          id: string
          notes: string | null
          round: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          application_id: string
          color?: string | null
          game_id: string
          id?: string
          notes?: string | null
          round: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          application_id?: string
          color?: string | null
          game_id?: string
          id?: string
          notes?: string | null
          round?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "round_candidates_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_candidates_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      video_grades: {
        Row: {
          application_id: string
          game_id: string
          graded_at: string
          grader_id: string
          id: string
          notes: string | null
          question_1_score: number
          question_2_choice: string | null
          question_2_score: number
          total_score: number | null
        }
        Insert: {
          application_id: string
          game_id: string
          graded_at?: string
          grader_id: string
          id?: string
          notes?: string | null
          question_1_score: number
          question_2_choice?: string | null
          question_2_score: number
          total_score?: number | null
        }
        Update: {
          application_id?: string
          game_id?: string
          graded_at?: string
          grader_id?: string
          id?: string
          notes?: string | null
          question_1_score?: number
          question_2_choice?: string | null
          question_2_score?: number
          total_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "video_grades_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_grades_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_game_exists: { Args: { p_game_id: string }; Returns: boolean }
      check_resume_exists: { Args: { p_resume_id: string }; Returns: boolean }
      create_game: {
        Args: { p_created_by: string; p_name: string }
        Returns: Json
      }
      generate_access_token: { Args: never; Returns: string }
      get_application_details: {
        Args: { p_application_id: string }
        Returns: Json
      }
      get_applications_for_grading: {
        Args: {
          p_game_id: string
          p_graded_only?: boolean
          p_grader_id: string
        }
        Returns: Json
      }
      get_combined_rankings: { Args: { p_game_id: string }; Returns: Json }
      get_default_application_game: { Args: never; Returns: Json }
      get_next_pair: {
        Args: { p_game_id: string; p_user_id: string }
        Returns: Json
      }
      get_resume_deliberation: { Args: { p_game_id: string }; Returns: Json }
      get_round_deliberation: {
        Args: { p_game_id: string; p_round: string }
        Returns: Json
      }
      get_user_comparison_count: {
        Args: { p_game_id: string; p_user_id: string }
        Returns: number
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_game_creator: {
        Args: { p_game_id: string; p_user_id: string }
        Returns: boolean
      }
      is_valid_game_id: { Args: { p_game_id: string }; Returns: boolean }
      is_valid_resume_id: { Args: { p_resume_id: string }; Returns: boolean }
      join_game_by_token: {
        Args: { p_access_token: string; p_user_id: string }
        Returns: Json
      }
      reorder_round_candidates: {
        Args: { p_updates: Json }
        Returns: undefined
      }
      seed_round_candidates: {
        Args: { p_game_id: string; p_round: string }
        Returns: undefined
      }
      set_round_candidate_color: {
        Args: { p_color: string; p_ids: string[] }
        Returns: undefined
      }
      submit_application:
        | {
            Args: {
              p_access_token: string
              p_act_score: string
              p_additional_info: string
              p_applicant_email: string
              p_applicant_name: string
              p_college_of_primary_major: string
              p_expected_graduation_year: string
              p_first_time_applying: string
              p_gender: string
              p_gpa: string
              p_how_did_you_hear: string
              p_major: string
              p_military_affiliated: string
              p_minor: string
              p_profile_picture_path: string
              p_resume_path: string
              p_sat_score: string
              p_video_question_2_choice: string
              p_video_youtube_url: string
              p_year: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_access_token?: string
              p_act_score: string
              p_additional_info: string
              p_applicant_email: string
              p_applicant_first_name: string
              p_applicant_last_name: string
              p_college_of_primary_major: string
              p_expected_graduation_year: string
              p_first_time_applying: string
              p_gender: string
              p_gpa: string
              p_how_did_you_hear: string
              p_major: string
              p_military_affiliated: string
              p_minor: string
              p_profile_picture_path: string
              p_resume_path: string
              p_sat_score: string
              p_video_question_2_choice: string
              p_video_youtube_url: string
              p_year: string
            }
            Returns: Json
          }
      submit_comparison: {
        Args: {
          p_game_id: string
          p_resume_a: string
          p_resume_b: string
          p_user_id: string
          p_winner: string
        }
        Returns: Json
      }
      submit_interview_score: {
        Args: {
          p_application_id: string
          p_availability: Json
          p_candidate_phone: string
          p_co_interviewer_name: string
          p_glaring_concerns: string
          p_interviewer_id: string
          p_overall_impression: string
          p_presentation_path: string
          p_recommendation: string
          p_room_label: string
          p_round: string
          p_section_scores: Json
          p_section_totals: Json
          p_total_score: number
        }
        Returns: Json
      }
      submit_video_grade: {
        Args: {
          p_application_id: string
          p_grader_id: string
          p_notes: string
          p_question_1_score: number
          p_question_2_choice: string
          p_question_2_score: number
        }
        Returns: Json
      }
      validate_access_token: { Args: { p_access_token: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "grader"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "grader"],
    },
  },
} as const
