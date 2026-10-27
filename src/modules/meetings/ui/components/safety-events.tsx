import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
    meetingId: string;
}

const severityColorMap = {
    block: "bg-rose-500/20 text-rose-800 border-rose-800/5",
    care: "bg-amber-500/20 text-amber-800 border-amber-800/5",
    log: "bg-gray-300/20 text-gray-800 border-gray-800/5",
};

const sourceLabelMap = {
    realtime: "In call",
    chat: "Chat",
    post_call: "Post-call audit",
};

export const SafetyEvents = ({ meetingId }: Props) => {
    const trpc = useTRPC();
    const { data } = useQuery(trpc.meetings.getSafetyEvents.queryOptions({ id: meetingId }));

    return (
        <div className="bg-white rounded-lg border px-4 py-5 flex flex-col gap-y-4 w-full">
            <p className="text-sm font-medium">Safety events</p>
            <ScrollArea>
                <div className="flex flex-col gap-y-4">
                    {(data ?? []).map((event) => (
                        <div
                            key={event.id}
                            className="flex flex-col gap-y-2 p-4 rounded-md border"
                        >
                            <div className="flex flex-wrap gap-2 items-center">
                                {event.severity && (
                                    <Badge
                                        variant="outline"
                                        className={cn("uppercase", severityColorMap[event.severity])}
                                    >
                                        {event.severity}
                                    </Badge>
                                )}
                                <Badge variant="outline" className="capitalize">{event.role}</Badge>
                                <Badge variant="outline">{sourceLabelMap[event.source]}</Badge>
                                <Badge variant="outline">{event.detector}</Badge>
                                <p className="text-sm text-muted-foreground">
                                    {format(event.createAt, "PPP p")}
                                </p>
                            </div>
                            {event.categories.length > 0 && (
                                <p className="text-sm text-muted-foreground">
                                    {event.categories.join(", ")}
                                </p>
                            )}
                            <p className="text-sm text-neutral-700">{event.content}</p>
                        </div>
                    ))}
                    {data?.length === 0 && (
                        <p className="text-sm text-muted-foreground">No safety events</p>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
};
