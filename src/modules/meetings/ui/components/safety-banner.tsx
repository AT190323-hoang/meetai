import { format } from "date-fns";
import { ShieldAlertIcon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import { MeetingGetOne } from "../../types";

interface Props {
    data: MeetingGetOne;
}

// An agent-caused flag is the system's fault, not the user's violation, so it is worded differently
export const SafetyBanner = ({ data }: Props) => {
    const trpc = useTRPC();
    const queryClient = useQueryClient();

    const acknowledgeSafety = useMutation(
        trpc.meetings.acknowledgeSafety.mutationOptions({
            onSuccess: async () => {
                await queryClient.invalidateQueries(trpc.meetings.getOne.queryOptions({ id: data.id }));
            },
        }),
    );

    const byAgent = data.flaggedBy === "agent";

    const title = byAgent
        ? "The system blocked unsafe content from the assistant"
        : "This meeting was flagged for safety violations";

    const description = data.quarantined
        ? byAgent
            ? "The summary, transcript and recording are hidden because they may contain unsafe content."
            : "Some requests in this meeting violated the safety rules. The summary, transcript and recording are hidden until you confirm the violation."
        : `You acknowledged this warning${data.safetyAcknowledgedAt ? ` on ${format(data.safetyAcknowledgedAt, "PPP p")}` : ""}.`;

    return (
        <Alert variant="destructive" className="border-destructive/30">
            <ShieldAlertIcon />
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription>
                <p>{description} Chat is locked for this meeting.</p>
                {data.quarantined && (
                    <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        disabled={acknowledgeSafety.isPending}
                        onClick={() => acknowledgeSafety.mutate({ id: data.id })}
                    >
                        {byAgent ? "I understand" : "Confirm violation"}
                    </Button>
                )}
            </AlertDescription>
        </Alert>
    );
};
