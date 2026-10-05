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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      archetype_capabilities: {
        Row: {
          archetype_id: string
          capability_id: string
        }
        Insert: {
          archetype_id: string
          capability_id: string
        }
        Update: {
          archetype_id?: string
          capability_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "archetype_capabilities_archetype_id_fkey"
            columns: ["archetype_id"]
            isOneToOne: false
            referencedRelation: "tenant_archetypes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "archetype_capabilities_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      archetype_integrations: {
        Row: {
          archetype_id: string
          integration_id: string
        }
        Insert: {
          archetype_id: string
          integration_id: string
        }
        Update: {
          archetype_id?: string
          integration_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "archetype_integrations_archetype_id_fkey"
            columns: ["archetype_id"]
            isOneToOne: false
            referencedRelation: "tenant_archetypes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "archetype_integrations_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      assertion_results: {
        Row: {
          actual_value: Json | null
          created_at: string
          id: string
          journey_assertion_id: string | null
          message: string | null
          passed: boolean
          run_step_result_id: string
        }
        Insert: {
          actual_value?: Json | null
          created_at?: string
          id?: string
          journey_assertion_id?: string | null
          message?: string | null
          passed: boolean
          run_step_result_id: string
        }
        Update: {
          actual_value?: Json | null
          created_at?: string
          id?: string
          journey_assertion_id?: string | null
          message?: string | null
          passed?: boolean
          run_step_result_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assertion_results_journey_assertion_id_fkey"
            columns: ["journey_assertion_id"]
            isOneToOne: false
            referencedRelation: "journey_assertions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assertion_results_run_step_result_id_fkey"
            columns: ["run_step_result_id"]
            isOneToOne: false
            referencedRelation: "run_step_results"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          workspace_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          workspace_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      capabilities: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          criticality: Database["public"]["Enums"]["criticality"]
          description: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          criticality?: Database["public"]["Enums"]["criticality"]
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          criticality?: Database["public"]["Enums"]["criticality"]
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capabilities_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      capability_path_rules: {
        Row: {
          capability_id: string
          created_at: string
          glob_pattern: string
          id: string
        }
        Insert: {
          capability_id: string
          created_at?: string
          glob_pattern: string
          id?: string
        }
        Update: {
          capability_id?: string
          created_at?: string
          glob_pattern?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "capability_path_rules_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["id"]
          },
        ]
      }
      credential_records: {
        Row: {
          archetype_id: string | null
          created_at: string
          created_by: string | null
          encrypted_payload: string
          encryption_version: number
          expires_at: string | null
          health_status: string
          id: string
          integration_id: string
          last_checked_at: string | null
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archetype_id?: string | null
          created_at?: string
          created_by?: string | null
          encrypted_payload: string
          encryption_version?: number
          expires_at?: string | null
          health_status?: string
          id?: string
          integration_id: string
          last_checked_at?: string | null
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archetype_id?: string | null
          created_at?: string
          created_by?: string | null
          encrypted_payload?: string
          encryption_version?: number
          expires_at?: string | null
          health_status?: string
          id?: string
          integration_id?: string
          last_checked_at?: string | null
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credential_records_archetype_id_fkey"
            columns: ["archetype_id"]
            isOneToOne: false
            referencedRelation: "tenant_archetypes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_records_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credential_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      failure_cluster_runs: {
        Row: {
          failure_cluster_id: string
          run_id: string
        }
        Insert: {
          failure_cluster_id: string
          run_id: string
        }
        Update: {
          failure_cluster_id?: string
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "failure_cluster_runs_failure_cluster_id_fkey"
            columns: ["failure_cluster_id"]
            isOneToOne: false
            referencedRelation: "failure_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "failure_cluster_runs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      failure_clusters: {
        Row: {
          created_at: string
          fingerprint: string
          first_seen_at: string
          id: string
          last_seen_at: string
          release_id: string | null
          status: Database["public"]["Enums"]["cluster_status"]
          summary: string | null
          suspected_cause: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          fingerprint: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          release_id?: string | null
          status?: Database["public"]["Enums"]["cluster_status"]
          summary?: string | null
          suspected_cause?: string | null
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          fingerprint?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          release_id?: string | null
          status?: Database["public"]["Enums"]["cluster_status"]
          summary?: string | null
          suspected_cause?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "failure_clusters_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "failure_clusters_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      github_installations: {
        Row: {
          created_at: string
          default_branch: string | null
          github_account_id: number | null
          github_account_login: string | null
          id: string
          installation_id: number
          installed_by: string | null
          repository_full_name: string | null
          repository_id: number | null
          repository_name: string | null
          repository_owner: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          default_branch?: string | null
          github_account_id?: number | null
          github_account_login?: string | null
          id?: string
          installation_id: number
          installed_by?: string | null
          repository_full_name?: string | null
          repository_id?: number | null
          repository_name?: string | null
          repository_owner?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          default_branch?: string | null
          github_account_id?: number | null
          github_account_login?: string | null
          id?: string
          installation_id?: number
          installed_by?: string | null
          repository_full_name?: string | null
          repository_id?: number | null
          repository_name?: string | null
          repository_owner?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_installations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          active: boolean
          base_url: string
          created_at: string
          environment: string
          id: string
          name: string
          provider_key: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          base_url: string
          created_at?: string
          environment?: string
          id?: string
          name: string
          provider_key: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          base_url?: string
          created_at?: string
          environment?: string
          id?: string
          name?: string
          provider_key?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      journey_assertions: {
        Row: {
          assertion_type: Database["public"]["Enums"]["assertion_type"]
          created_at: string
          expected_value: Json | null
          id: string
          journey_step_id: string
          operator: string
          target: string | null
        }
        Insert: {
          assertion_type: Database["public"]["Enums"]["assertion_type"]
          created_at?: string
          expected_value?: Json | null
          id?: string
          journey_step_id: string
          operator?: string
          target?: string | null
        }
        Update: {
          assertion_type?: Database["public"]["Enums"]["assertion_type"]
          created_at?: string
          expected_value?: Json | null
          id?: string
          journey_step_id?: string
          operator?: string
          target?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journey_assertions_journey_step_id_fkey"
            columns: ["journey_step_id"]
            isOneToOne: false
            referencedRelation: "journey_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      journey_capabilities: {
        Row: {
          capability_id: string
          journey_id: string
        }
        Insert: {
          capability_id: string
          journey_id: string
        }
        Update: {
          capability_id?: string
          journey_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journey_capabilities_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journey_capabilities_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "journeys"
            referencedColumns: ["id"]
          },
        ]
      }
      journey_steps: {
        Row: {
          continue_on_failure: boolean
          created_at: string
          extraction_rules: Json
          id: string
          is_cleanup: boolean
          journey_id: string
          method: Database["public"]["Enums"]["http_method"]
          name: string
          path_template: string
          position: number
          request_body: Json | null
          request_headers: Json
          updated_at: string
        }
        Insert: {
          continue_on_failure?: boolean
          created_at?: string
          extraction_rules?: Json
          id?: string
          is_cleanup?: boolean
          journey_id: string
          method?: Database["public"]["Enums"]["http_method"]
          name: string
          path_template: string
          position: number
          request_body?: Json | null
          request_headers?: Json
          updated_at?: string
        }
        Update: {
          continue_on_failure?: boolean
          created_at?: string
          extraction_rules?: Json
          id?: string
          is_cleanup?: boolean
          journey_id?: string
          method?: Database["public"]["Enums"]["http_method"]
          name?: string
          path_template?: string
          position?: number
          request_body?: Json | null
          request_headers?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "journey_steps_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "journeys"
            referencedColumns: ["id"]
          },
        ]
      }
      journeys: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          integration_id: string | null
          name: string
          timeout_ms: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          integration_id?: string | null
          name: string
          timeout_ms?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          integration_id?: string | null
          name?: string
          timeout_ms?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "journeys_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journeys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      release_archetype_selections: {
        Row: {
          archetype_id: string
          coverage_score: number | null
          release_id: string
          selection_reason: string | null
        }
        Insert: {
          archetype_id: string
          coverage_score?: number | null
          release_id: string
          selection_reason?: string | null
        }
        Update: {
          archetype_id?: string
          coverage_score?: number | null
          release_id?: string
          selection_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "release_archetype_selections_archetype_id_fkey"
            columns: ["archetype_id"]
            isOneToOne: false
            referencedRelation: "tenant_archetypes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_archetype_selections_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
        ]
      }
      release_capabilities: {
        Row: {
          capability_id: string
          reason: string | null
          release_id: string
        }
        Insert: {
          capability_id: string
          reason?: string | null
          release_id: string
        }
        Update: {
          capability_id?: string
          reason?: string | null
          release_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_capabilities_capability_id_fkey"
            columns: ["capability_id"]
            isOneToOne: false
            referencedRelation: "capabilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "release_capabilities_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
        ]
      }
      release_changed_files: {
        Row: {
          additions: number
          deletions: number
          id: string
          path: string
          release_id: string
          status: string | null
        }
        Insert: {
          additions?: number
          deletions?: number
          id?: string
          path: string
          release_id: string
          status?: string | null
        }
        Update: {
          additions?: number
          deletions?: number
          id?: string
          path?: string
          release_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "release_changed_files_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
        ]
      }
      releases: {
        Row: {
          author_login: string | null
          commit_sha: string
          completed_at: string | null
          created_at: string
          discovered_at: string
          github_installation_id: string | null
          id: string
          pull_request_number: number | null
          ref: string | null
          repository_full_name: string
          status: Database["public"]["Enums"]["release_status"]
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          author_login?: string | null
          commit_sha: string
          completed_at?: string | null
          created_at?: string
          discovered_at?: string
          github_installation_id?: string | null
          id?: string
          pull_request_number?: number | null
          ref?: string | null
          repository_full_name: string
          status?: Database["public"]["Enums"]["release_status"]
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          author_login?: string | null
          commit_sha?: string
          completed_at?: string | null
          created_at?: string
          discovered_at?: string
          github_installation_id?: string | null
          id?: string
          pull_request_number?: number | null
          ref?: string | null
          repository_full_name?: string
          status?: Database["public"]["Enums"]["release_status"]
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "releases_github_installation_id_fkey"
            columns: ["github_installation_id"]
            isOneToOne: false
            referencedRelation: "github_installations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "releases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      run_step_results: {
        Row: {
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          error_code: string | null
          error_message: string | null
          fingerprint: string | null
          id: string
          journey_step_id: string | null
          position: number
          request_summary: Json | null
          response_summary: Json | null
          run_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          fingerprint?: string | null
          id?: string
          journey_step_id?: string | null
          position: number
          request_summary?: Json | null
          response_summary?: Json | null
          run_id: string
          started_at?: string | null
          status: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          error_code?: string | null
          error_message?: string | null
          fingerprint?: string | null
          id?: string
          journey_step_id?: string | null
          position?: number
          request_summary?: Json | null
          response_summary?: Json | null
          run_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "run_step_results_journey_step_id_fkey"
            columns: ["journey_step_id"]
            isOneToOne: false
            referencedRelation: "journey_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_step_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          archetype_id: string
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          id: string
          journey_id: string
          release_id: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["run_status"]
          trigger_type: Database["public"]["Enums"]["run_trigger"]
          triggered_by: string | null
          workspace_id: string
        }
        Insert: {
          archetype_id: string
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          journey_id: string
          release_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["run_status"]
          trigger_type?: Database["public"]["Enums"]["run_trigger"]
          triggered_by?: string | null
          workspace_id: string
        }
        Update: {
          archetype_id?: string
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          id?: string
          journey_id?: string
          release_id?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["run_status"]
          trigger_type?: Database["public"]["Enums"]["run_trigger"]
          triggered_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_archetype_id_fkey"
            columns: ["archetype_id"]
            isOneToOne: false
            referencedRelation: "tenant_archetypes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_journey_id_fkey"
            columns: ["journey_id"]
            isOneToOne: false
            referencedRelation: "journeys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_archetypes: {
        Row: {
          active: boolean
          auth_mode: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          metadata: Json
          name: string
          permission_profile: string
          region: string
          risk_weight: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          active?: boolean
          auth_mode?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          name: string
          permission_profile?: string
          region?: string
          risk_weight?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          active?: boolean
          auth_mode?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json
          name?: string
          permission_profile?: string
          region?: string
          risk_weight?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_archetypes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      waivers: {
        Row: {
          approved_by: string
          created_at: string
          expires_at: string | null
          failure_cluster_id: string | null
          id: string
          reason: string
          release_id: string
          scope: string
          workspace_id: string
        }
        Insert: {
          approved_by?: string
          created_at?: string
          expires_at?: string | null
          failure_cluster_id?: string | null
          id?: string
          reason: string
          release_id: string
          scope: string
          workspace_id: string
        }
        Update: {
          approved_by?: string
          created_at?: string
          expires_at?: string | null
          failure_cluster_id?: string | null
          id?: string
          reason?: string
          release_id?: string
          scope?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waivers_failure_cluster_id_fkey"
            columns: ["failure_cluster_id"]
            isOneToOne: false
            referencedRelation: "failure_clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waivers_release_id_fkey"
            columns: ["release_id"]
            isOneToOne: false
            referencedRelation: "releases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waivers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["workspace_role"]
          token_hash: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role: Database["public"]["Enums"]["workspace_role"]
          token_hash: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          token_hash?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          plan: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          plan?: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          plan?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      archetype_ws: { Args: { _id: string }; Returns: string }
      can_admin: { Args: { _ws: string }; Returns: boolean }
      can_edit: { Args: { _ws: string }; Returns: boolean }
      capability_ws: { Args: { _id: string }; Returns: string }
      create_workspace: {
        Args: { _name: string; _slug: string }
        Returns: string
      }
      has_workspace_role: {
        Args: {
          _roles: Database["public"]["Enums"]["workspace_role"][]
          _ws: string
        }
        Returns: boolean
      }
      is_workspace_member: { Args: { _ws: string }; Returns: boolean }
      is_workspace_owner: { Args: { _ws: string }; Returns: boolean }
      journey_ws: { Args: { _id: string }; Returns: string }
      release_ws: { Args: { _id: string }; Returns: string }
      run_ws: { Args: { _id: string }; Returns: string }
      step_ws: { Args: { _id: string }; Returns: string }
    }
    Enums: {
      assertion_type:
        | "http_status"
        | "json_path_equals"
        | "json_path_exists"
        | "json_path_type"
        | "header_exists"
        | "max_latency_ms"
      cluster_status: "open" | "acknowledged" | "resolved" | "ignored"
      criticality: "low" | "medium" | "high" | "critical"
      http_method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"
      release_status:
        | "discovered"
        | "planning"
        | "running"
        | "passed"
        | "failed"
        | "waived"
        | "error"
      run_status:
        | "queued"
        | "running"
        | "passed"
        | "failed"
        | "error"
        | "cancelled"
      run_trigger: "manual" | "pull_request" | "rerun"
      workspace_role: "owner" | "admin" | "engineer" | "viewer"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      assertion_type: [
        "http_status",
        "json_path_equals",
        "json_path_exists",
        "json_path_type",
        "header_exists",
        "max_latency_ms",
      ],
      cluster_status: ["open", "acknowledged", "resolved", "ignored"],
      criticality: ["low", "medium", "high", "critical"],
      http_method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
      release_status: [
        "discovered",
        "planning",
        "running",
        "passed",
        "failed",
        "waived",
        "error",
      ],
      run_status: [
        "queued",
        "running",
        "passed",
        "failed",
        "error",
        "cancelled",
      ],
      run_trigger: ["manual", "pull_request", "rerun"],
      workspace_role: ["owner", "admin", "engineer", "viewer"],
    },
  },
} as const
