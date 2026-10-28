import { useState } from "react";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";

import { useTRPC } from "@/trpc/client";
import { PII_LABELS, type PiiType } from "@/lib/pii-marker";
import { cn } from "@/lib/utils";

interface Props {
    meetingId: string;
    itemId: string;
    index: number;
    type: PiiType;
    length: number;
}

// The value is never sent before a click, so the blurred text is a stand-in of the same length
const standIn = (type: PiiType, length: number) =>
    type === "email"
        ? `${"x".repeat(Math.max(1, length - 8))}@xxxx.xx`.slice(0, length)
        : "0912 345 678 901 234 567".slice(0, length);

/** Masked personal data in the transcript: blurred until the owner clicks it (the reveal is logged). */
export const PiiValue = ({ meetingId, itemId, index, type, length }: Props) => {
    const trpc = useTRPC();
    const [value, setValue] = useState<string | null>(null);
    const reveal = useMutation(trpc.meetings.revealPii.mutationOptions({
        onSuccess: (data) => setValue(data.value),
        onError: (error) => toast.error(error.message),
    }));

    if (value !== null) {
        return <span className="rounded bg-yellow-100 px-1 font-mono">{value}</span>;
    }

    return (
        <button
            type="button"
            title={`${PII_LABELS[type]} — bấm để hiện`}
            aria-label={`${PII_LABELS[type]} đã ẩn, bấm để hiện`}
            disabled={reveal.isPending}
            onClick={() => reveal.mutate({ meetingId, itemId, index })}
            className={cn(
                "rounded bg-muted px-1 font-mono select-none cursor-pointer blur-[3px] hover:blur-[2px] transition",
                reveal.isPending && "animate-pulse",
            )}
        >
            {standIn(type, length)}
        </button>
    );
};
