import { motion } from "framer-motion";
import { PlusCircle, Inbox, Trash2, ArrowRight, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useCampaignsStore,
  type CampaignStatus,
} from "@/lib/campaigns-list-store";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { useLocalOnlyMode } from "@/core/settings/use-local-only-mode";
import { useCloudAuthStore } from "@/integrations/supabase/cloud-auth-store";
import { deleteCloudCampaign } from "@/integrations/supabase/cloud-data";

const STATUS_CONFIG: Record<
  CampaignStatus,
  { label: string; className: string }
> = {
  draft: {
    label: "Draft",
    className: "bg-muted text-muted-foreground border-border",
  },
  in_review: {
    label: "In Review",
    className: "bg-secondary text-secondary-foreground border-secondary",
  },
  approved: {
    label: "Approved",
    className:
      "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800",
  },
  sent: {
    label: "Sent",
    className: "bg-primary/10 text-primary border-primary/20",
  },
};

export default function CampaignsPage() {
  const navigate = useNavigate();
  const { campaigns, deleteCampaign } = useCampaignsStore();
  const localOnly = useLocalOnlyMode();
  const user = useCloudAuthStore((s) => s.user);

  return (
    <div className="space-y-8">
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex items-start justify-between"
      >
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">
            Campaigns
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage, review, and approve your email campaigns.
          </p>
        </div>
        <Button
          className="bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={() => navigate("/create")}
        >
          <PlusCircle className="h-4 w-4" />
          New Campaign
        </Button>
      </motion.div>

      {/* Empty state */}
      {campaigns.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-col items-center justify-center py-24 space-y-5 border border-dashed border-border rounded-xl bg-muted/20"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
            <Inbox className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center space-y-1">
            <p className="font-semibold text-foreground">No campaigns yet</p>
            <p className="text-sm text-muted-foreground">
              Create your first campaign to get started.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/create")}>
            <PlusCircle className="h-4 w-4" />
            Create Campaign
          </Button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="space-y-2"
        >
          {campaigns.map((campaign, index) => {
            const status = STATUS_CONFIG[campaign.status];
            return (
              <motion.div
                key={campaign.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="group flex items-center gap-4 border border-border rounded-lg bg-card px-5 py-4 hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer"
                onClick={() => navigate(`/campaigns/${campaign.id}`)}
              >
                {/* Icon */}
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Mail className="h-4 w-4 text-primary" />
                </div>

                {/* Name + prompt */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {campaign.name}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {campaign.prompt}
                  </p>
                </div>

                {/* Meta */}
                <div className="flex items-center gap-5 shrink-0">
                  <div className="text-center hidden sm:block">
                    <p className="text-xs font-mono-display font-semibold text-foreground">
                      {campaign.emails.length}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {campaign.emails.length === 1 ? "email" : "emails"}
                    </p>
                  </div>

                  <Badge
                    variant="outline"
                    className={`text-[11px] font-medium px-2.5 py-0.5 ${status.className}`}
                  >
                    {status.label}
                  </Badge>

                  <p className="text-xs text-muted-foreground hidden md:block w-20 text-right">
                    {formatDistanceToNow(new Date(campaign.createdAt), {
                      addSuffix: true,
                    })}
                  </p>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCampaign(campaign.id);
                      if (!localOnly && user?.id) {
                        void deleteCloudCampaign(user.id, campaign.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>

                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}
