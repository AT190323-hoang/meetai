"use client";
import { Button } from "@/components/ui/button"
import { PlusIcon } from "lucide-react";
import { NewMeetingDialog } from "./new-meeting-dialog";
import { useState } from "react";


export const MeetingsListHeader = () => {
   const [isDialogOpen, setIsDiaLogOpen] = useState(false);
        return (
        <>
          <NewMeetingDialog open ={isDialogOpen} onOpenChange = {setIsDiaLogOpen} />
            <div className="py-4 px-4 md:px-8 flex flex-col gap-y-4 ">
                <div className="flex itmes-center justify-between" >
                    <h5 className="font-medium text-xl">My Meetings</h5>
                    <Button onClick={() => setIsDiaLogOpen(true)}>
                        <PlusIcon />
                        New Meeting
                    </Button>
                </div>
                <div className="flex items-center gap-x-2 p-1">
          TODO
                </div>
            </div>
        </>
    )
}