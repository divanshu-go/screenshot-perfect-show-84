import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useWorkspaceRealtime(workspaceId: string, tables: string[], queryKeys: string[]) {
  const queryClient = useQueryClient();
  const tableKey = tables.join(",");
  const queryKey = queryKeys.join(",");

  useEffect(() => {
    const channel = supabase.channel(`workspace:${workspaceId}:${tableKey}`);
    for (const table of tableKey.split(",")) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          for (const key of queryKey.split(",")) {
            void queryClient.invalidateQueries({ queryKey: [key, workspaceId] });
          }
        },
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, queryKey, tableKey, workspaceId]);
}
