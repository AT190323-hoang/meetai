import { useEffect, useState } from "react";
import { CallingState, StreamTheme, useCall, useCallStateHooks } from "@stream-io/video-react-sdk";
import { CallLobby } from "./call-lobby";
import { CallActive } from "./call-active";
import { CallEnded } from "./call-ended";


interface Props {
    meetingName: string;
};

export const CallUI = ({ meetingName }: Props) => {
    const call = useCall();

    const [show, setShow] = useState<"lobby" | "call" | "ended">("lobby");
    // Set when the call ends without the user leaving (e.g. the safety kill-switch ends it)
    const [endedRemotely, setEndedRemotely] = useState(false);
    const { useCallCallingState } = useCallStateHooks();
    const callingState = useCallCallingState();

    // The SDK leaves the call on its own when the server ends it; follow it to the ended screen
    useEffect(() => {
        if (show === "call" && callingState === CallingState.LEFT) {
            setEndedRemotely(true);
            setShow("ended");
        }
    }, [show, callingState]);

    const handleJoin = async () => {
        if (!call) return;

        await call.join();

        setShow("call");
    };

    const handleLeave = () => {
        if (!call) return;
        call.endCall();
        setShow("ended");
    };

    return (
        <StreamTheme className="h-full">
            {show === "lobby" && <CallLobby onJoin={handleJoin} />}
            {show === "call" && <CallActive onLeave={handleLeave} meetingName={meetingName} />}
            {show === "ended" && <CallEnded endedRemotely={endedRemotely} />}
        </StreamTheme>
    )

};