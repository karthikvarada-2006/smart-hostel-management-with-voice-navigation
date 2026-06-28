import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { VoiceTask } from "@/types/voice";


// Types for Web Speech API
interface SpeechRecognitionEvent extends Event {
    results: SpeechRecognitionResultList;
    resultIndex: number;
}

interface SpeechRecognitionErrorEvent extends Event {
    error: string;
}

interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    grammars: any;
    start(): void;
    stop(): void;
    onstart: (() => void) | null;
    onresult: (event: SpeechRecognitionEvent) => void;
    onerror: (event: SpeechRecognitionErrorEvent) => void;
    onend: () => void;
}

declare global {
    interface Window {
        webkitSpeechRecognition: new () => SpeechRecognition;
        webkitSpeechGrammarList: new () => any;
    }
}

const AudioVisualizer = ({ isListening }: { isListening: boolean }) => {
    const [volumes, setVolumes] = useState<number[]>(new Array(10).fill(2));
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    useEffect(() => {
        if (!isListening) {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            if (audioContextRef.current) audioContextRef.current.close();
            setVolumes(new Array(10).fill(2));
            return;
        }

        const startAudio = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                const analyser = audioContext.createAnalyser();
                const source = audioContext.createMediaStreamSource(stream);
                source.connect(analyser);
                analyser.fftSize = 64;
                
                audioContextRef.current = audioContext;
                analyserRef.current = analyser;

                const bufferLength = analyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);

                const update = () => {
                    analyser.getByteFrequencyData(dataArray);
                    // Take a slice of frequencies and map to heights
                    const newVolumes = Array.from(dataArray.slice(0, 10)).map(v => Math.max(2, v / 6));
                    setVolumes(newVolumes);
                    animationFrameRef.current = requestAnimationFrame(update);
                };
                update();
            } catch (err) {
                console.error("Audio visualizer failed:", err);
            }
        };

        startAudio();
        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            if (audioContextRef.current) audioContextRef.current.close();
        };
    }, [isListening]);

    return (
        <div className="flex items-end gap-[3px] h-6 px-1">
            {volumes.map((vol, i) => (
                <div 
                    key={i} 
                    className="w-1 bg-primary rounded-full transition-all duration-75"
                    style={{ height: `${vol}px`, opacity: 0.4 + (vol / 20) }}
                />
            ))}
        </div>
    );
};

export function VoiceNavigation() {
    const [isListening, setIsListening] = useState(false);
    const [isSupported, setIsSupported] = useState(true);
    const [voiceStatus, setVoiceStatus] = useState<{ title: string; message: string; type: "info" | "success" | "error" } | null>(null);
    const [transcribedText, setTranscribedText] = useState("");
    const recognitionRef = useRef<SpeechRecognition | null>(null);
    const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const navigate = useNavigate();
    const { toast } = useToast();
    const { isAdmin, signOut, profile } = useAuth();

    useEffect(() => {
        if (!("webkitSpeechRecognition" in window)) {
            setIsSupported(false);
        }
    }, []);

    const speakResponse = useCallback((text: string) => {
        if (!window.speechSynthesis) return;
        // Cancel any ongoing speech
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 0.8;
        window.speechSynthesis.speak(utterance);
    }, []);

    // Helper: dispatch a voice task to a page with pending task storage + retry
    // Pages check (window as any).__pendingVoiceTask on data load
    const dispatchVoiceTask = (detail: VoiceTask) => {
      (window as any).__pendingVoiceTask = detail;
        // Dispatch immediately (works if already on the page with data)
        window.dispatchEvent(new CustomEvent("voicetask", { detail }));
        // Retry after page has time to mount + fetch data
        setTimeout(() => {
            // Only dispatch if the pending task hasn't been consumed yet
            if ((window as any).__pendingVoiceTask) {
                window.dispatchEvent(new CustomEvent("voicetask", { detail: (window as any).__pendingVoiceTask }));
            }
        }, 2000);
    };

    // --- Dynamic Command Registry ---
    const commandHandlers: Record<string, (params: Partial<VoiceTask>) => Promise<void> | void> = {
        navigate: (params) => {
            const page = params.page?.toLowerCase();
            const routes: Record<string, string> = {
                dashboard: isAdmin ? "/admin/dashboard" : "/dashboard",
                complaints: isAdmin ? "/admin/complaints" : "/complaints",
                passes: isAdmin ? "/admin/passes" : "/passes",
                attendance: isAdmin ? "/admin/attendance" : "/attendance",
                menu: isAdmin ? "/admin/menu" : "/menu",
                students: "/admin/students",
                profile: "/profile",
                notices: isAdmin ? "/admin/notices" : "/notices",
                history: isAdmin ? "/admin/passes?status=approved" : "/history-passes",
                resolved_complaints: isAdmin ? "/admin/complaints?status=resolved" : "/resolved-complaints",
            };
            const target = routes[page] || routes.dashboard;
            navigate(target);
            speakResponse(`Opening ${page || "dashboard"}`);
        },
        delete_student: async (params) => {
            if (!isAdmin) return speakResponse("Only admins can delete students");
            const name = params.name;
            console.log("[VoiceDelete] Attempting to delete student with name:", JSON.stringify(name), "params:", JSON.stringify(params));
            if (!name) return speakResponse("Please provide a student name. Say: delete student followed by the name.");

            // Query Supabase directly — no page-state dependency
            const { data: students, error: queryError } = await supabase
                .from("profiles")
                .select("id, user_id, full_name, role")
                .eq("role", "student")
                .ilike("full_name", `%${name}%`);

            console.log("[VoiceDelete] Query result:", { students, queryError, searchName: name });

            if (queryError) {
                speakResponse(`Error searching for student: ${queryError.message}`);
                return;
            }

            if (!students || students.length === 0) {
                // Try a wider search without role filter
                const { data: allProfiles } = await supabase
                    .from("profiles")
                    .select("id, user_id, full_name, role")
                    .ilike("full_name", `%${name}%`);
                console.log("[VoiceDelete] Wider search (no role filter):", allProfiles);

                if (allProfiles && allProfiles.length > 0) {
                    // Found a match without role filter — use it
                    const student = allProfiles[0];
                    const { error } = await supabase.from("profiles").delete().eq("id", student.id);
                    if (error) {
                        speakResponse(`Failed to delete: ${error.message}`);
                        return;
                    }
                    try { await supabase.rpc("delete_auth_user", { target_user_id: student.user_id }); } catch (_) {}
                    speakResponse(`Student ${student.full_name} deleted successfully`);
                    navigate("/admin/students");
                    return;
                }

                speakResponse(`No student named ${name} found. Please try again with the exact name.`);
                return;
            }

            const student = students[0];
            console.log("[VoiceDelete] Deleting student:", student);
            const { error } = await supabase.from("profiles").delete().eq("id", student.id);
            if (error) {
                speakResponse(`Failed to delete student: ${error.message}`);
                return;
            }

            // Try to delete auth user too
            try {
                await supabase.rpc("delete_auth_user", { target_user_id: student.user_id });
            } catch (_) { /* ignore if function doesn't exist */ }

            speakResponse(`Student ${student.full_name} deleted successfully`);
            navigate("/admin/students");
        },
        add_student: (params: Partial<VoiceTask>) => {
            const name = params.name || "";
            navigate("/admin/students");
            dispatchVoiceTask({ action: "create", target: "student", name });
            speakResponse(name ? `Opening add student form for ${name}` : "Opening add student form");
        },
        edit_student: (params: Partial<VoiceTask>) => {
            if (!isAdmin) return speakResponse("Only admins can edit students");
            const name = params.name;
            if (!name) return speakResponse("Please provide a student name");
            navigate("/admin/students");
            dispatchVoiceTask({ action: "edit", target: "student", name });
            speakResponse(`Opening edit form for student ${name}`);
        },
        view_complaints: (params: Partial<VoiceTask>) => {
            const status = params.status || "";
            const path = isAdmin ? "/admin/complaints" : "/complaints";
            navigate(status ? `${path}?status=${status}` : path);
            speakResponse(`Showing ${status || "all"} complaints`);
        },
        add_complaint: async (params: Partial<VoiceTask>) => {
            // If title+description provided (from voice), create directly
            const title = params?.title || "";
            const description = params?.description || "";
            if (title && profile?.id) {
                const { error } = await supabase.from("complaints").insert({
                    title,
                    description: description || title,
                    student_id: profile.id,
                    status: "pending",
                    priority: params.priority || "medium",
                });
                if (error) {
                    speakResponse(`Failed to file complaint: ${error.message}`);
                } else {
                    speakResponse(`Complaint "${title}" filed successfully`);
                }
                navigate(isAdmin ? "/admin/complaints" : "/complaints");
                return;
            }
            // Otherwise just open the form
            navigate(isAdmin ? "/admin/complaints" : "/complaints?new=true");
            speakResponse("Opening new complaint form");
        },
        file_complaint: async (params: Partial<VoiceTask>) => {
            if (!profile?.id) return speakResponse("You need to be logged in");

            const title = params.title || "";
            const description = params.description || "";
            if (!title) return speakResponse("Please provide a title. Say: raise complaint with title something and description something");

            const { error } = await supabase.from("complaints").insert({
                title,
                description: description || title,
                student_id: profile.id,
                status: "pending",
                priority: params.priority || "medium",
            });

            if (error) {
                speakResponse(`Failed to file complaint: ${error.message}`);
            } else {
                speakResponse(`Complaint "${title}" filed successfully`);
            }
            navigate(isAdmin ? "/admin/complaints" : "/complaints");
        },
        edit_complaint: async (params: Partial<VoiceTask>) => {
            if (!profile?.id) return speakResponse("You need to be logged in");

            const complaintName = params.name || "";
            const newTitle = params.newTitle || "";
            const newDescription = params.newDescription || "";

            if (!newTitle && !newDescription) {
                return speakResponse("Please specify what to change. Say: edit complaint [name] title [new title] or description [new description]");
            }

            // Students see only their own complaints, admins see all
            let query = supabase.from("complaints").select("id, title, description, student_id");
            if (!isAdmin) query = query.eq("student_id", profile.id);
            const { data: complaints } = await query.order("created_at", { ascending: false });

            if (!complaints || complaints.length === 0) {
                speakResponse("No complaints found");
                return;
            }

            let target;
            if (complaintName) {
                target = complaints.find(c => c.title.toLowerCase().includes(complaintName.toLowerCase()));
                if (!target) {
                    speakResponse(`No complaint matching "${complaintName}" found`);
                    return;
                }
            } else {
                const idx = (params.positionIndex || 1);
                const realIdx = idx === -1 ? complaints.length - 1 : idx - 1;
                if (realIdx < 0 || realIdx >= complaints.length) {
                    speakResponse(`Complaint number ${idx} not found. There are ${complaints.length} complaints.`);
                    return;
                }
                target = complaints[realIdx];
            }

            const updateData: any = { is_edited: true };
            if (newTitle) updateData.title = newTitle;
            if (newDescription) updateData.description = newDescription;

            const { error } = await supabase.from("complaints").update(updateData).eq("id", target.id);

            if (error) {
                speakResponse(`Failed to edit complaint: ${error.message}`);
            } else {
                const changes = [newTitle ? `title to "${newTitle}"` : "", newDescription ? `description` : ""].filter(Boolean).join(" and ");
                speakResponse(`Complaint "${target.title}" updated: ${changes}`);
            }
            navigate(isAdmin ? "/admin/complaints" : "/complaints");
        },
        resolve_complaint: async (params: Partial<VoiceTask>) => {
            if (!isAdmin) return speakResponse("Only admins can resolve complaints");
            const description = params.description || "Resolved via voice command";
            const complaintName = params.name || "";

            // Query pending complaints
            const { data: complaints } = await supabase
                .from("complaints")
                .select("id, title")
                .eq("status", "pending")
                .order("created_at", { ascending: params.position === "last" });

            if (!complaints || complaints.length === 0) {
                speakResponse("No pending complaints found");
                return;
            }

            // Find target: by name/title if provided, otherwise by position
            let target;
            if (complaintName) {
                target = complaints.find(c => c.title.toLowerCase().includes(complaintName.toLowerCase()));
                if (!target) {
                    speakResponse(`No pending complaint matching "${complaintName}" found`);
                    return;
                }
            } else {
                const idx = (params.positionIndex || 1);
                const realIdx = idx === -1 ? complaints.length - 1 : idx - 1;
                if (realIdx < 0 || realIdx >= complaints.length) {
                    speakResponse(`Complaint number ${idx} not found. There are ${complaints.length} pending complaints.`);
                    return;
                }
                target = complaints[realIdx];
            }

            const { error } = await supabase
                .from("complaints")
                .update({ status: "resolved", resolution_notes: description })
                .eq("id", target.id);

            if (error) {
                speakResponse("Failed to resolve complaint");
            } else {
                speakResponse(`Complaint "${target.title}" resolved`);
            }
            navigate("/admin/complaints");
        },
        delete_complaint: async (params: Partial<VoiceTask>) => {
            // Query complaints directly from DB
            const statusFilter = "pending";
            const { data: complaints } = await supabase
                .from("complaints")
                .select("id, title")
                .eq("status", statusFilter)
                .order("created_at", { ascending: params.position === "last" });

            if (!complaints || complaints.length === 0) {
                speakResponse("No complaints found to delete");
                return;
            }

            const idx = (params.positionIndex || 1);
            const realIdx = idx === -1 ? complaints.length - 1 : idx - 1;
            if (realIdx < 0 || realIdx >= complaints.length) {
                speakResponse(`Complaint number ${idx} not found. There are ${complaints.length} complaints.`);
                return;
            }
            const target = complaints[realIdx];
            const { error } = await supabase.from("complaints").delete().eq("id", target.id);
            if (error) {
                speakResponse("Failed to delete complaint");
            } else {
                speakResponse(`Complaint "${target.title}" deleted`);
            }
            navigate(isAdmin ? "/admin/complaints" : "/complaints");
        },
        filter_complaints: (params: Partial<VoiceTask>) => {
            const status = params.status || "pending";
            const path = isAdmin ? "/admin/complaints" : "/complaints";
            navigate(`${path}?status=${status}`);
            speakResponse(`Showing ${status.replace("_", " ")} complaints`);
        },
        update_complaint_status: async (params: Partial<VoiceTask>) => {
            if (!isAdmin) return speakResponse("Only admins can update complaints");
            const complaintName = params.name || "";
            // Normalize: "in progress" → "in_progress" for the DB enum
            let newStatus = (params.status || "in_progress").toLowerCase().replace(/\s+/g, "_");
            if (newStatus === "inprogress") newStatus = "in_progress";

            const { data: complaints } = await supabase
                .from("complaints")
                .select("id, title, status")
                .order("created_at", { ascending: params.position === "last" });

            if (!complaints || complaints.length === 0) {
                speakResponse("No complaints found");
                return;
            }

            let target;
            if (complaintName) {
                target = complaints.find(c => c.title.toLowerCase().includes(complaintName.toLowerCase()));
                if (!target) {
                    speakResponse(`No complaint matching "${complaintName}" found`);
                    return;
                }
            } else {
                const idx = (params.positionIndex || 1);
                const realIdx = idx === -1 ? complaints.length - 1 : idx - 1;
                if (realIdx < 0 || realIdx >= complaints.length) {
                    speakResponse(`Complaint number ${idx} not found. There are ${complaints.length} complaints.`);
                    return;
                }
                target = complaints[realIdx];
            }

            const { error } = await supabase
                .from("complaints")
                .update({ status: newStatus as "pending" | "in_progress" | "resolved" })
                .eq("id", target.id);

            const statusLabel = newStatus.replace("_", " ");
            if (error) {
                speakResponse(`Failed to update complaint status`);
            } else {
                speakResponse(`Complaint "${target.title}" updated to ${statusLabel}`);
            }
            navigate("/admin/complaints");
        },
        mark_attendance: () => {
            navigate("/admin/attendance");
            dispatchVoiceTask({ action: "mark", target: "attendance" });
            speakResponse("Marking all students as present");
        },
        mark_all_absent: () => {
            if (!isAdmin) return speakResponse("Only admins can mark attendance");
            navigate("/admin/attendance");
            dispatchVoiceTask({ action: "mark_all_absent", target: "attendance" });
            speakResponse("Marking all students as absent");
        },
        mark_student_attendance: (params: Partial<VoiceTask>) => {
            if (!isAdmin) return speakResponse("Only admins can mark attendance");
            // Support both single name and names array
            const names: string[] = params.names || (params.name ? [params.name] : []);
            const status = params.status || "present";
            if (names.length === 0) return speakResponse("Please provide student names");
            navigate("/admin/attendance");
            dispatchVoiceTask({ action: "mark_student", target: "attendance", names, status });
            speakResponse(`Marking ${names.join(" and ")} as ${status}`);
        },
        submit_attendance: () => {
            navigate("/admin/attendance");
            dispatchVoiceTask({ action: "resolve", target: "attendance" });
            speakResponse("Submitting attendance records");
        },
        approve_pass: async (params: Partial<VoiceTask>) => {
            if (!isAdmin) return speakResponse("Only admins can approve passes");
            const studentName = params.name || "";

            const { data: passes } = await supabase
                .from("passes")
                .select("id, profiles!passes_student_id_fkey(full_name)")
                .eq("status", "pending")
                .order("created_at", { ascending: params.position === "last" });

            if (!passes || passes.length === 0) {
                speakResponse("No pending passes found");
                return;
            }

            // Find target: by student name if provided, otherwise by position
            let target: any;
            if (studentName) {
                target = passes.find((p: any) => {
                    const name = p.profiles?.full_name || "";
                    return name.toLowerCase().includes(studentName.toLowerCase());
                });
                if (!target) {
                    speakResponse(`No pending pass found for student "${studentName}"`);
                    return;
                }
            } else {
                const idx = (params.positionIndex || 1);
                const realIdx = idx === -1 ? passes.length - 1 : idx - 1;
                if (realIdx < 0 || realIdx >= passes.length) {
                    speakResponse(`Pass number ${idx} not found. There are ${passes.length} pending passes.`);
                    return;
                }
                target = passes[realIdx];
            }

            const { error } = await supabase
                .from("passes")
                .update({ status: "approved", admin_comment: "Approved via voice command", approved_by: profile?.id })
                .eq("id", target.id);

            const who = target.profiles?.full_name || (params.position || "first");
            if (error) speakResponse("Failed to approve pass");
            else speakResponse(`Pass for ${who} has been approved`);
            navigate("/admin/passes");
        },
        reject_pass: async (params: Partial<VoiceTask>) => {
            if (!isAdmin) return speakResponse("Only admins can reject passes");
            const studentName = params.name || "";

            const { data: passes } = await supabase
                .from("passes")
                .select("id, profiles!passes_student_id_fkey(full_name)")
                .eq("status", "pending")
                .order("created_at", { ascending: params.position === "last" });

            if (!passes || passes.length === 0) {
                speakResponse("No pending passes found");
                return;
            }

            let target: any;
            if (studentName) {
                target = passes.find((p: any) => {
                    const name = p.profiles?.full_name || "";
                    return name.toLowerCase().includes(studentName.toLowerCase());
                });
                if (!target) {
                    speakResponse(`No pending pass found for student "${studentName}"`);
                    return;
                }
            } else {
                const idx = (params.positionIndex || 1);
                const realIdx = idx === -1 ? passes.length - 1 : idx - 1;
                if (realIdx < 0 || realIdx >= passes.length) {
                    speakResponse(`Pass number ${idx} not found. There are ${passes.length} pending passes.`);
                    return;
                }
                target = passes[realIdx];
            }

            const { error } = await supabase
                .from("passes")
                .update({ status: "rejected", admin_comment: "Rejected via voice command", approved_by: profile?.id })
                .eq("id", target.id);

            const who = target.profiles?.full_name || (params.position || "first");
            if (error) speakResponse("Failed to reject pass");
            else speakResponse(`Pass for ${who} has been rejected`);
            navigate("/admin/passes");
        },
        delete_pass: async (params: Partial<VoiceTask>) => {
            const studentName = params.name || "";

            const { data: passes } = await supabase
                .from("passes")
                .select("id, profiles!passes_student_id_fkey(full_name)")
                .eq("status", "pending")
                .order("created_at", { ascending: params.position === "last" });

            if (!passes || passes.length === 0) {
                speakResponse("No passes found to delete");
                return;
            }

            let target: any;
            if (studentName) {
                target = passes.find((p: any) => {
                    const name = p.profiles?.full_name || "";
                    return name.toLowerCase().includes(studentName.toLowerCase());
                });
                if (!target) {
                    speakResponse(`No pending pass found for student "${studentName}"`);
                    return;
                }
            } else {
                const idx = (params.positionIndex || 1);
                const realIdx = idx === -1 ? passes.length - 1 : idx - 1;
                if (realIdx < 0 || realIdx >= passes.length) {
                    speakResponse(`Pass number ${idx} not found. There are ${passes.length} pending passes.`);
                    return;
                }
                target = passes[realIdx];
            }

            const { error } = await supabase.from("passes").delete().eq("id", target.id);
            const who = target.profiles?.full_name || (params.position || "first");
            if (error) speakResponse("Failed to delete pass");
            else speakResponse(`Pass for ${who} has been deleted`);
            navigate(isAdmin ? "/admin/passes" : "/passes");
        },
        apply_pass: () => {
            navigate(isAdmin ? "/admin/passes" : "/passes?new=true");
            speakResponse("Opening pass request form");
        },
        filter_passes: (params: Partial<VoiceTask>) => {
            const status = params.status || "pending";
            const path = isAdmin ? "/admin/passes" : "/passes";
            navigate(`${path}?status=${status}`);
            speakResponse(`Showing ${status} passes`);
        },
        add_notice: (params: Partial<VoiceTask>) => {
            navigate("/admin/notices");
            dispatchVoiceTask({ action: "create", target: "notice" });
            speakResponse("Opening notice creation form");
        },
        post_notice: async (params: Partial<VoiceTask>) => {
            if (!isAdmin) return speakResponse("Only admins can post notices");
            if (!profile?.id) return speakResponse("You need to be logged in");

            const title = params.title || "";
            const content = params.content || "";
            if (!title) return speakResponse("Please provide a title. Say: post notice with title something and content something");

            const { error } = await supabase.from("notices").insert({
                title,
                content: content || title,
                created_by: profile.id,
                is_important: params.important || false,
            });

            if (error) {
                speakResponse(`Failed to post notice: ${error.message}`);
            } else {
                speakResponse(`Notice "${title}" posted successfully`);
            }
            navigate("/admin/notices");
        },
        delete_notice: async (params: Partial<VoiceTask>) => {
            if (!isAdmin) return speakResponse("Only admins can delete notices");

            const { data: notices } = await supabase
                .from("notices")
                .select("id, title")
                .eq("is_archived", false)
                .order("created_at", { ascending: params.position === "last" });

            if (!notices || notices.length === 0) {
                speakResponse("No notices found to delete");
                return;
            }

            const idx = (params.positionIndex || 1);
            const realIdx = idx === -1 ? notices.length - 1 : idx - 1;
            if (realIdx < 0 || realIdx >= notices.length) {
                speakResponse(`Notice number ${idx} not found. There are ${notices.length} notices.`);
                return;
            }
            const target = notices[realIdx];
            const { error } = await supabase.from("notices").delete().eq("id", target.id);
            if (error) speakResponse("Failed to delete notice");
            else speakResponse(`Notice "${target.title}" deleted`);
            navigate("/admin/notices");
        },
        edit_notice: (params: Partial<VoiceTask>) => {
            if (!isAdmin) return speakResponse("Only admins can edit notices");
            const pos = params.position === "last" ? -1 : 0;
            navigate("/admin/notices");
            dispatchVoiceTask({ action: "edit", target: "notice", index: pos });
            speakResponse(`Opening edit form for the ${params.position || "first"} notice`);
        },
        archive_notice: async (params: Partial<VoiceTask>) => {
            if (!isAdmin) return speakResponse("Only admins can archive notices");

            const { data: notices } = await supabase
                .from("notices")
                .select("id, title")
                .eq("is_archived", false)
                .order("created_at", { ascending: params.position === "last" });

            if (!notices || notices.length === 0) {
                speakResponse("No active notices found");
                return;
            }

            const idx = (params.positionIndex || 1);
            const realIdx = idx === -1 ? notices.length - 1 : idx - 1;
            if (realIdx < 0 || realIdx >= notices.length) {
                speakResponse(`Notice number ${idx} not found. There are ${notices.length} active notices.`);
                return;
            }
            const target = notices[realIdx];
            const { error } = await supabase
                .from("notices")
                .update({ is_archived: true })
                .eq("id", target.id);

            if (error) speakResponse("Failed to archive notice");
            else speakResponse(`Notice "${target.title}" archived`);
            navigate("/admin/notices");
        },
        edit_menu: () => {
            if (!isAdmin) return speakResponse("Only admins can edit the menu");
            navigate("/admin/menu");
            dispatchVoiceTask({ action: "edit", target: "menu" });
            speakResponse("Opening today's menu for editing");
        },
        set_menu: async (params: any) => {
            if (!isAdmin) return speakResponse("Only admins can set the menu");
            if (!profile?.id) return speakResponse("You need to be logged in");

            const { meal, food, dateStr, meals } = params;

            // Determine what meals to save: either a single meal or multiple
            const mealsToSave: Record<string, string> = {};
            if (meals && typeof meals === "object") {
                // Multiple meals: { breakfast: "idli", lunch: "rice", dinner: "chapati" }
                Object.assign(mealsToSave, meals);
            } else if (meal && food) {
                mealsToSave[meal.toLowerCase()] = food;
            } else {
                return speakResponse("Please specify the meal and food. For example: today breakfast is idli");
            }

            if (Object.keys(mealsToSave).length === 0) {
                return speakResponse("Could not understand the menu items. Please try again.");
            }

            // Parse the date
            // Helper to format a local Date as YYYY-MM-DD without UTC conversion
            const toLocalDateStr = (dt: Date): string => {
                const y = dt.getFullYear();
                const m = String(dt.getMonth() + 1).padStart(2, "0");
                const d = String(dt.getDate()).padStart(2, "0");
                return `${y}-${m}-${d}`;
            };

            const parseMenuDate = (d: string): string => {
                const today = new Date();
                const lower = d.toLowerCase().trim();
                if (!lower || lower === "today") return toLocalDateStr(today);
                if (lower === "tomorrow") {
                    const t = new Date(today); t.setDate(t.getDate() + 1);
                    return toLocalDateStr(t);
                }
                // Try parsing "25 march", "march 25", "25 march 2026", etc.
                const months: Record<string, number> = {
                    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
                    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
                    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
                };
                // "25 march" or "25 march 2026"
                let match = lower.match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/);
                if (match) {
                    const day = parseInt(match[1]);
                    const month = months[match[2]];
                    const year = match[3] ? parseInt(match[3]) : today.getFullYear();
                    if (month !== undefined && day >= 1 && day <= 31) {
                        return toLocalDateStr(new Date(year, month, day));
                    }
                }
                // "march 25" or "march 25 2026"
                match = lower.match(/([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?/);
                if (match) {
                    const month = months[match[1]];
                    const day = parseInt(match[2]);
                    const year = match[3] ? parseInt(match[3]) : today.getFullYear();
                    if (month !== undefined && day >= 1 && day <= 31) {
                        return toLocalDateStr(new Date(year, month, day));
                    }
                }
                return toLocalDateStr(today);
            };

            const menuDate = parseMenuDate(dateStr || "today");
            console.log("[SetMenu] date:", menuDate, "meals:", mealsToSave);

            // Check if a menu row exists for this date
            const { data: existing } = await supabase
                .from("food_menu")
                .select("id")
                .eq("menu_date", menuDate)
                .maybeSingle();

            const updateData: any = { ...mealsToSave, created_by: profile.id };

            if (existing) {
                const { error } = await supabase
                    .from("food_menu")
                    .update(updateData)
                    .eq("id", existing.id);
                if (error) {
                    speakResponse(`Failed to update menu: ${error.message}`);
                } else {
                    const mealNames = Object.keys(mealsToSave).map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(", ");
                    speakResponse(`${mealNames} for ${dateStr || "today"} updated successfully`);
                }
            } else {
                updateData.menu_date = menuDate;
                const { error } = await supabase.from("food_menu").insert(updateData);
                if (error) {
                    speakResponse(`Failed to save menu: ${error.message}`);
                } else {
                    const mealNames = Object.keys(mealsToSave).map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(", ");
                    speakResponse(`${mealNames} for ${dateStr || "today"} saved successfully`);
                }
            }
            navigate(isAdmin ? "/admin/menu" : "/menu");
        },
        view_menu: async (params: any) => {
            const { dateStr } = params;

            // Reuse the same local date helper
            const toLocalDateStr2 = (dt: Date): string => {
                const y = dt.getFullYear();
                const m = String(dt.getMonth() + 1).padStart(2, "0");
                const d = String(dt.getDate()).padStart(2, "0");
                return `${y}-${m}-${d}`;
            };

            const parseViewDate = (d: string): string => {
                const today = new Date();
                const lower = d.toLowerCase().trim();
                if (!lower || lower === "today") return toLocalDateStr2(today);
                if (lower === "tomorrow") {
                    const t = new Date(today); t.setDate(t.getDate() + 1);
                    return toLocalDateStr2(t);
                }
                const months: Record<string, number> = {
                    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
                    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
                    jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
                };
                let match = lower.match(/(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/);
                if (match) {
                    const day = parseInt(match[1]);
                    const month = months[match[2]];
                    const year = match[3] ? parseInt(match[3]) : today.getFullYear();
                    if (month !== undefined && day >= 1 && day <= 31) {
                        return toLocalDateStr2(new Date(year, month, day));
                    }
                }
                match = lower.match(/([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?/);
                if (match) {
                    const month = months[match[1]];
                    const day = parseInt(match[2]);
                    const year = match[3] ? parseInt(match[3]) : today.getFullYear();
                    if (month !== undefined && day >= 1 && day <= 31) {
                        return toLocalDateStr2(new Date(year, month, day));
                    }
                }
                return toLocalDateStr2(today);
            };

            const menuDate = parseViewDate(dateStr || "today");
            console.log("[ViewMenu] Fetching menu for date:", menuDate);

            // Navigate to menu page with date param so it displays the requested date
            const menuPath = isAdmin ? "/admin/menu" : "/menu";
            navigate(`${menuPath}?date=${menuDate}`);

            // Also fetch and speak the menu
            const { data, error } = await supabase
                .from("food_menu")
                .select("breakfast, lunch, dinner")
                .eq("menu_date", menuDate)
                .maybeSingle();

            if (error) {
                speakResponse(`Failed to fetch menu: ${error.message}`);
                return;
            }

            if (!data) {
                speakResponse(`No menu found for ${dateStr || "today"}`);
                return;
            }

            const parts: string[] = [];
            if (data.breakfast) parts.push(`Breakfast is ${data.breakfast}`);
            if (data.lunch) parts.push(`Lunch is ${data.lunch}`);
            if (data.dinner) parts.push(`Dinner is ${data.dinner}`);

            if (parts.length === 0) {
                speakResponse(`Menu for ${dateStr || "today"} has no items set yet`);
            } else {
                speakResponse(`Menu for ${dateStr || "today"}: ${parts.join(", ")}`);
            }
        },
        scroll: (params: any) => {
            const direction = params.direction || "down";
            const amount = direction === "up" ? -500 : 500;
            window.scrollBy({ top: amount, behavior: "smooth" });
            speakResponse(`Scrolling ${direction}`);
        },
        logout: () => {
            speakResponse("Goodbye! Signing you out now.");
            setTimeout(() => signOut(), 1500);
        },
        go_back: () => {
            window.history.back();
            speakResponse("Going back");
        },
        refresh: () => {
            window.location.reload();
            speakResponse("Refreshing page");
        },
        switch_theme: (params: Partial<VoiceTask>) => {
            const setTheme = (window as any).__setTheme;
            const currentTheme = (window as any).__theme;
            if (setTheme) {
                const target = params.theme === "toggle" ? (currentTheme === "dark" ? "light" : "dark") : params.theme;
                if (target && (target === "dark" || target === "light")) {
                    setTheme(target);
                    speakResponse(`Switching to ${target} mode`);
                }
            } else {
                speakResponse("Theme switching is not yet initialized");
            }
        },
        search: (params: Partial<VoiceTask>) => {
            if (!params.query) return speakResponse("What would you like to search for?");
            speakResponse(`Searching for ${params.query}`);
            // This event can be caught by pages to filter results
            window.dispatchEvent(new CustomEvent("voice-search", { detail: params.query }));
        },
        help: () => {
            const helpText = isAdmin
                ? "Admin commands: Navigate (dashboard, complaints, etc.), add/edit/delete students, mark attendance by name or for all, approve/reject passes, resolve complaints, post notices, and set menu. Utility: dark mode, light mode, search for something, go back, refresh, logout."
                : "Student commands: Navigate (dashboard, complaints, passes, etc.), file a complaint, apply for a pass, view menu and attendance. Utility: dark mode, light mode, search for something, go back, refresh, logout.";
            speakResponse(helpText);
            setVoiceStatus({
                title: "Voice Assistant Help",
                message: helpText,
                type: "info"
            });
        }
    };

    // --- Local Fallback Intent Parser (Used if Edge Function fails) ---
    const localIntentParser = (text: string) => {
        const rawText = text.toLowerCase().trim().replace(/[.,!?]+$/, "");
        let result = { intent: "unknown", entity: "none", parameters: {} as any };

        // --- Fuzzy Matching & Keyword Mapping ---
        const STOP_WORDS = new Set(["i", "want", "to", "show", "me", "please", "a", "the", "any", "today", "can", "you", "give", "help", "take", "navigate"]);
        
        const KEYWORD_MAP: Record<string, string[]> = {
            complaints: ["complaint", "complaints", "issue", "problem", "complain", "complane"],
            passes: ["pass", "gatepass", "leave", "outing", "vacation"],
            notices: ["notice", "notices", "announcement", "notis"],
            dashboard: ["dashboard", "home", "main"],
            attendance: ["attendance", "roll", "present", "absent"],
            menu: ["menu", "food", "canteen", "breakfast", "lunch", "dinner", "meal"],
            students: ["student", "user", "member", "management"],
            profile: ["profile", "account", "settings"],
            rooms: ["room", "allocation", "hostel"],
            history: ["history", "past passes", "previous passes", "old passes"],
            resolved_complaints: ["resolved complaints", "finished complaints", "solved complaints", "fixed complaints"]
        };

        const getSimilarity = (s1: string, s2: string): number => {
            if (s1 === s2) return 1.0;
            if (s1.length < 3 || s2.length < 3) return s1 === s2 ? 1.0 : 0;
            if (s1.includes(s2) || s2.includes(s1)) return 0.8;
            
            const editDistance = (a: string, b: string): number => {
                const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
                for (let j = 1; j <= b.length; j++) matrix[0][j] = j;
                for (let i = 1; i <= a.length; i++) {
                    for (let j = 1; j <= b.length; j++) {
                        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                        matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
                    }
                }
                return matrix[a.length][b.length];
            };
            
            const dist = editDistance(s1, s2);
            return 1 - dist / Math.max(s1.length, s2.length);
        };

        const tokens = rawText.split(/\s+/).filter(word => !STOP_WORDS.has(word));

        // Helper to check if a phrase exists with word boundaries
        const has = (phrase: string) => {
            if (new RegExp(`\\b${phrase}\\b`, "i").test(rawText)) return true;
            // Check tokens for fuzzy match
            return tokens.some(token => getSimilarity(token, phrase) > 0.8);
        };

        // Helper to check for command patterns (Action + Object)
        const isAction = (action: string, target: string) => {
            const hasAction = new RegExp(`\\b(${action})\\b`, "i").test(rawText) || tokens.some(t => action.split("|").some(a => getSimilarity(t, a) > 0.8));
            const hasTarget = new RegExp(`\\b(${target})\\b`, "i").test(rawText) || tokens.some(t => target.split("|").some(tg => getSimilarity(t, tg) > 0.8));
            return hasAction && hasTarget;
        };

        const posParam = () => {
            // Map ordinal words to numbers
            const ordinals: Record<string, number> = {
                first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
                sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
                "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5,
                "6th": 6, "7th": 7, "8th": 8, "9th": 9, "10th": 10,
                last: -1,
            };
            for (const [word, num] of Object.entries(ordinals)) {
                if (has(word)) return { position: word, positionIndex: num };
            }
            // Check for plain number: "complaint 3"
            const numMatch = rawText.match(/\b(\d+)(?:st|nd|rd|th)?\b/);
            if (numMatch) return { position: numMatch[0], positionIndex: parseInt(numMatch[1]) };
            return { position: "first", positionIndex: 1 };
        };

        console.log(`[LocalParser] Analyzing: "${rawText}" | Tokens: ${tokens.join(", ")}`);

        // 1. HIGH CONFIDENCE ACTIONS (Stricter matching — order matters!)

        // --- Attendance ---
        // "mark all present" / "mark all absent" / "mark everyone present" / "present all"
        if (isAction("mark|present|absent", "all|everyone|every|students") || has("present all|absent all")) {
            if (has("absent")) return { intent: "mark_all_absent", entity: "attendance", parameters: {} };
            return { intent: "mark_attendance", entity: "attendance", parameters: {} };
        }

        // Per-student(s): "mark karthik present" / "mark karthik and sai kumar as present" / "present for karthik"
        const markStudentMatch = rawText.match(/\b(?:mark|present\s+for|absent\s+for)\s+(.+?)\s*(?:(?:as\s+)?(present|absent))?\b/i);
        if (markStudentMatch || has("present for") || has("absent for")) {
            let status = markStudentMatch?.[2]?.toLowerCase();
            if (!status) {
                if (has("present")) status = "present";
                else if (has("absent")) status = "absent";
            }
            
            if (status) {
                const rawName = (markStudentMatch?.[1] || rawText.replace(/\b(present\s+for|absent\s+for|present|absent|for|mark|as|the)\b/gi, "")).trim().replace(/[.,!?]+$/, "");
                if (rawName && !/^(all|everyone|every|students)$/i.test(rawName)) {
                    // Split by "and", commas, or "as"
                    const names = rawName.split(/\s+and\s+|,\s*|\s+as\s+/i).map(n => n.trim()).filter(Boolean);
                    console.log("[LocalParser] mark_student_attendance, names:", JSON.stringify(names));
                    return { intent: "mark_student_attendance", entity: "attendance", parameters: { names, status } };
                }
            }
        }
        if (isAction("submit|finish|save", "attendance")) return { intent: "submit_attendance", entity: "attendance", parameters: {} };


        // --- Passes: approve / reject / delete ---
        // Extract student name and position from pass commands
        // Patterns: "approve pass for karthik", "reject outing pass for mani", "reject the first pass", "approve last pass"
        const extractPassParams = (): { position: string; name: string } => {
            const position = has("last") ? "last" : "first";
            // Try "for [name]" pattern first
            const forMatch = rawText.match(/\bfor\s+(.+?)(?:\s*$)/i);
            if (forMatch) {
                const name = forMatch[1].replace(/[.,!?]+$/, "").trim();
                return { position, name };
            }
            // Try "[name]'s pass" pattern
            const possessiveMatch = rawText.match(/\b(\w+(?:\s+\w+)?)'?s?\s+(?:pass|outing|vacation)/i);
            if (possessiveMatch) {
                const name = possessiveMatch[1].replace(/\b(the|first|last|outing|home|vacation)\b/gi, "").trim();
                if (name && !(/^(pass|request)$/i.test(name))) return { position, name };
            }
            return { position, name: "" };
        };

        if (isAction("approve|accept", "pass|request|outing|vacation")) {
            const passParams = extractPassParams();
            console.log("[LocalParser] approve_pass:", passParams);
            return { intent: "approve_pass", entity: "pass", parameters: passParams };
        }
        if (isAction("reject|deny|decline", "pass|request|outing|vacation")) {
            const passParams = extractPassParams();
            console.log("[LocalParser] reject_pass:", passParams);
            return { intent: "reject_pass", entity: "pass", parameters: passParams };
        }
        if (isAction("delete|remove|clear", "pass|outing|vacation")) {
            const passParams = extractPassParams();
            console.log("[LocalParser] delete_pass:", passParams);
            return { intent: "delete_pass", entity: "pass", parameters: passParams };
        }
        if (isAction("apply|request|new", "pass|outing|vacation")) {
            return { intent: "apply_pass", entity: "pass", parameters: {} };
        }

        // --- Complaints: edit / update status / resolve / delete ---
        // Edit complaint: "edit complaint water leakage title new title"
        //   "edit complaint water leakage description new description"
        //   "change complaint title water problem" (edits most recent)
        //   "edit complaint water leakage title water problem and description the pipe is leaking"
        const editComplaintMatch = rawText.match(
            /\b(?:edit|modify|change)\s+(?:the\s+)?(?:complaint|problem|issue)\s+(?:(.+?)\s+)?(?:title\s+(.+?))?(?:\s+(?:and\s+)?description\s+(.+))?$/i
        );
        if (editComplaintMatch && (editComplaintMatch[2] || editComplaintMatch[3])) {
            let name = (editComplaintMatch[1] || "").trim().replace(/[.,!?]+$/, "");
            const newTitle = (editComplaintMatch[2] || "").trim().replace(/[.,!?]+$/, "").replace(/\s+and\s*$/, "");
            const newDescription = (editComplaintMatch[3] || "").trim().replace(/[.,!?]+$/, "");
            // Clean name
            name = name.replace(/\b(the|first|last)\b/gi, "").trim();
            console.log("[LocalParser] edit_complaint:", { name, newTitle, newDescription });
            return { intent: "edit_complaint", entity: "complaint", parameters: { name, newTitle, newDescription } };
        }
        // Also handle: "edit complaint description [text]" (no name, edits most recent)
        const editComplaintDescOnly = rawText.match(
            /\b(?:edit|modify|change)\s+(?:the\s+)?(?:complaint|problem|issue)\s+description\s+(.+)/i
        );
        if (editComplaintDescOnly) {
            const newDescription = editComplaintDescOnly[1].trim().replace(/[.,!?]+$/, "");
            console.log("[LocalParser] edit_complaint (desc only):", { newDescription });
            return { intent: "edit_complaint", entity: "complaint", parameters: { name: "", newTitle: "", newDescription } };
        }
        // Also handle: "edit complaint title [text]" (no name, edits most recent)
        const editComplaintTitleOnly = rawText.match(
            /\b(?:edit|modify|change)\s+(?:the\s+)?(?:complaint|problem|issue)\s+title\s+(.+)/i
        );
        if (editComplaintTitleOnly) {
            const newTitle = editComplaintTitleOnly[1].trim().replace(/[.,!?]+$/, "");
            console.log("[LocalParser] edit_complaint (title only):", { newTitle });
            return { intent: "edit_complaint", entity: "complaint", parameters: { name: "", newTitle, newDescription: "" } };
        }

        // --- Update status / resolve / delete ---
        // "update complaint to in progress" / "mark complaint water leakage as in progress"
        // "change the first complaint to in progress" / "update complaint to pending"
        const statusUpdateMatch = rawText.match(
            /\b(?:update|change|mark|set|move)\b\s+(?:the\s+)?(?:(first|last)\s+)?(?:(?:complaint|problem|issue)\s+)?(.+?)\s+(?:to|as|status)\s+(in\s*progress|pending|resolved?)\b/i
        );
        if (statusUpdateMatch && !has("resolve the") && !has("resolve complaint")) {
            const posWord = statusUpdateMatch[1];
            let name = (statusUpdateMatch[2] || "").trim().replace(/[.,!?]+$/, "");
            let status = statusUpdateMatch[3].toLowerCase().replace(/\s+/g, "_");
            // Normalize: "resolved" -> "resolved", "in progress" -> "in_progress"
            if (status === "resolve" || status === "resolved") status = "resolved";
            if (status === "in_progress" || status === "inprogress") status = "in_progress";

            // Clean name: handle "update complaint to pending" (name is "complaint" or empty)
            if (/^(the\s+)?(complaint|problem|issue|first|last|to)?\s*$/i.test(name)) name = "";
            name = name.replace(/\b(the|complaint|problem|issue|first|last|to)\b/gi, "").trim();

            const position = posWord?.toLowerCase() || (has("last") ? "last" : "first");
            console.log("[LocalParser] update_complaint_status:", { name, position, status });
            return { intent: "update_complaint_status", entity: "complaint", parameters: { name, position, status } };
        }

        // Patterns for resolve:
        //   "resolve the first complaint"
        //   "resolve the last complaint"
        //   "resolve complaint water leakage"
        //   "resolve the water leakage complaint"
        //   "resolve complaint water leakage with fixed the pipe"
        const resolveComplaintMatch = rawText.match(
            /\bresolve\b\s+(?:the\s+)?(?:(first|last)\s+)?(?:(?:complaint|problem|issue)\s+)?(.+?)(?:\s+(?:complaint|problem|issue))?(?:\s+with\s+(.+))?$/i
        );
        if (resolveComplaintMatch && has("resolve")) {
            const posWord = resolveComplaintMatch[1];
            let name = (resolveComplaintMatch[2] || "").trim().replace(/[.,!?]+$/, "");
            const desc = (resolveComplaintMatch[3] || "").trim().replace(/[.,!?]+$/, "");

            // If the name is just "complaint"/"problem"/"issue" or empty, it's position-based
            if (/^(the\s+)?(complaint|problem|issue|first|last)?\s*$/i.test(name)) {
                name = "";
            }
            // Clean out leftover keywords from name
            name = name.replace(/\b(the|complaint|problem|issue|first|last)\b/gi, "").trim();

            const position = posWord?.toLowerCase() || (has("last") ? "last" : "first");
            console.log("[LocalParser] resolve_complaint:", { name, position, description: desc });
            return { intent: "resolve_complaint", entity: "complaint", parameters: { name, position, description: desc } };
        }
        if (isAction("delete|remove|clear|resolve", "complaint|problem|issue")) {
            // Fallback for simple "resolve complaint"
            if (has("resolve")) return { intent: "resolve_complaint", entity: "complaint", parameters: { name: "", position: "first", description: "" } };
            return { intent: "delete_complaint", entity: "complaint", parameters: posParam() };
        }
        // "raise complaint with title water leakage and description water is leaking from pipe"
        const fileComplaintMatch = rawText.match(
            /\b(?:file|add|raise|report|create)\s+(?:a\s+|new\s+)?(?:complaint|problem|issue)\s+(?:with\s+)?title\s+(.+?)\s+(?:and\s+)?(?:description|content|details)\s+(.+)/i
        );
        if (fileComplaintMatch) {
            const title = fileComplaintMatch[1].trim().replace(/[.,!?]+$/, "");
            const description = fileComplaintMatch[2].trim().replace(/[.,!?]+$/, "");
            const priority = has("high|urgent") ? "high" : has("low") ? "low" : "medium";
            console.log("[LocalParser] add_complaint (with data):", { title, description, priority });
            return { intent: "add_complaint", entity: "complaint", parameters: { title, description, priority } };
        }
        if (isAction("file|add|new|raise|report", "complaint|problem|issue")) return { intent: "add_complaint", entity: "complaint", parameters: {} };

        // --- Notices: archive / edit / add / delete ---
        if (isAction("archive|hide", "notice|announcement")) {
            return { intent: "archive_notice", entity: "notice", parameters: posParam() };
        }
        if (isAction("edit|modify|change", "notice|announcement")) {
            return { intent: "edit_notice", entity: "notice", parameters: posParam() };
        }
        // "post notice with title X and content Y" / "create notice title X content Y"
        const noticePostMatch = rawText.match(
            /\b(?:post|create|add|publish)\s+(?:a\s+|new\s+)?(?:notice|announcement)\s+(?:with\s+)?title\s+(.+?)\s+(?:and\s+)?content\s+(.+)/i
        );
        if (noticePostMatch) {
            const title = noticePostMatch[1].trim().replace(/[.,!?]+$/, "");
            const content = noticePostMatch[2].trim().replace(/[.,!?]+$/, "");
            const important = has("important|urgent");
            console.log("[LocalParser] post_notice:", { title, content, important });
            return { intent: "post_notice", entity: "notice", parameters: { title, content, important } };
        }
        if (isAction("add|post|new|create", "notice|announcement")) return { intent: "add_notice", entity: "notice", parameters: {} };
        if (isAction("delete|remove|clear", "notice|announcement")) return { intent: "delete_notice", entity: "notice", parameters: posParam() };

        // --- Students: add / delete / edit ---
        // Improved: use a regex that extracts the name after "student/user/member" keyword, stripping filler words
        const extractStudentName = (input: string): string => {
            // Match everything after "student", "user", or "member", stripping words like "named", "called", "the"
            const match = input.match(/\b(?:student|user|member)\s+(?:named|called|name|the|is)?\s*(.+)/i);
            if (match && match[1]) return match[1].trim().replace(/[.,!?]+$/, "");
            // Fallback: try to get name after the action word itself
            const fallback = input.match(/\b(?:delete|remove|edit|modify|add|create)\s+(?:the\s+)?(.+?)\s*$/i);
            if (fallback && fallback[1]) {
                // Remove the target keyword from the result
                return fallback[1].replace(/\b(student|user|member)\b/gi, "").trim();
            }
            return "";
        };

        if (isAction("edit|modify|change", "student|user|member")) {
            const name = extractStudentName(rawText);
            console.log("[LocalParser] edit_student, extracted name:", JSON.stringify(name));
            return { intent: "edit_student", entity: "student", parameters: { name } };
        }
        if (isAction("add|new|post|create", "student|user|member")) {
            const name = extractStudentName(rawText);
            console.log("[LocalParser] add_student, extracted name:", JSON.stringify(name));
            return { intent: "add_student", entity: "student", parameters: { name } };
        }
        if (isAction("delete|remove|clear", "student|user|member")) {
            const name = extractStudentName(rawText);
            console.log("[LocalParser] delete_student, extracted name:", JSON.stringify(name));
            return { intent: "delete_student", entity: "student", parameters: { name } };
        }

        // --- Menu: set meal(s) ---
        // Check if multiple meals are mentioned (e.g. "today breakfast is idli, lunch is rice, dinner is chapati")
        const mealWords = "breakfast|lunch|dinner";
        const mealKeywordCount = (rawText.match(/\b(breakfast|lunch|dinner)\b/gi) || []).length;

        // --- Menu: view/show menu for a specific date ---
        // "show april 11 menu", "show menu for april 11", "view today's menu"
        // "what is the menu for april 11", "april 11 menu"
        const viewMenuMatch = rawText.match(
            /\b(?:show|view|display|what(?:'s|\s+is)(?:\s+the)?)\s+(?:(?:menu|food)\s+(?:for|on|of)\s+)?(today|tomorrow|(?:\d{1,2}\s+[a-z]+(?:\s+\d{4})?)|(?:[a-z]+\s+\d{1,2}(?:\s+\d{4})?))(?:'s)?\s*(?:menu|food)?$/i
        );
        if (viewMenuMatch) {
            const dateStr = viewMenuMatch[1].trim().replace(/[.,!?]+$/, "");
            console.log("[LocalParser] view_menu:", { dateStr });
            return { intent: "view_menu", entity: "menu", parameters: { dateStr } };
        }
        // Also match: "show menu for today", "show menu for tomorrow", "show menu for april 11"
        const viewMenuMatch2 = rawText.match(
            /\b(?:show|view|display)\s+(?:the\s+)?menu\s+(?:for|on|of)\s+(today|tomorrow|(?:\d{1,2}\s+[a-z]+(?:\s+\d{4})?)|(?:[a-z]+\s+\d{1,2}(?:\s+\d{4})?))\b/i
        );
        if (viewMenuMatch2) {
            const dateStr = viewMenuMatch2[1].trim().replace(/[.,!?]+$/, "");
            console.log("[LocalParser] view_menu (alt):", { dateStr });
            return { intent: "view_menu", entity: "menu", parameters: { dateStr } };
        }
        // Match: "april 11 menu" / "tomorrow menu" / "today menu" (date followed by menu)
        const viewMenuMatch3 = rawText.match(
            /^(?:show\s+)?(?:the\s+)?(today|tomorrow|(?:\d{1,2}\s+[a-z]+(?:\s+\d{4})?)|(?:[a-z]+\s+\d{1,2}(?:\s+\d{4})?))(?:'s)?\s+menu$/i
        );
        if (viewMenuMatch3) {
            const dateStr = viewMenuMatch3[1].trim().replace(/[.,!?]+$/, "");
            console.log("[LocalParser] view_menu (date+menu):", { dateStr });
            return { intent: "view_menu", entity: "menu", parameters: { dateStr } };
        }

        if (mealKeywordCount >= 2) {
            // Multi-meal pattern: split text by meal keywords, extract food after "is/to/as"
            // Extract optional date from the beginning
            const dateMatch = rawText.match(/^(?:(?:add|set|update|change)\s+)?(?:(?:for\s+)?(today|tomorrow|(?:\d{1,2}\s+[a-z]+(?:\s+\d{4})?)|(?:[a-z]+\s+\d{1,2}(?:\s+\d{4})?))\s+)?/i);
            const dateStr = (dateMatch?.[1] || "today").trim().replace(/[.,!?]+$/, "");

            const meals: Record<string, string> = {};
            // Split by meal keywords and extract food items
            const mealRegex = /\b(breakfast|lunch|dinner)\s+(?:is|to|as|will be|menu is|should be)?\s*([^,]*?)(?=\s*,?\s*(?:and\s+)?(?:breakfast|lunch|dinner)\b|$)/gi;
            let m;
            while ((m = mealRegex.exec(rawText)) !== null) {
                const mealType = m[1].toLowerCase();
                const foodItems = m[2].trim().replace(/[.,!?]+$/, "").replace(/\s+and\s*$/, "");
                if (foodItems) meals[mealType] = foodItems;
            }

            if (Object.keys(meals).length >= 2) {
                console.log("[LocalParser] set_menu (multi):", { dateStr, meals });
                return { intent: "set_menu", entity: "menu", parameters: { dateStr, meals } };
            }
        }

        // Single meal pattern:
        //   "add today breakfast is idli and upma with chutney"
        //   "today breakfast is idli"
        //   "25 march breakfast is poori"
        //   "tomorrow lunch is dal rice"
        const menuSetMatch = rawText.match(
            new RegExp(
                `(?:(?:add|set|update|change)\\s+)?` +
                `(?:(?:for\\s+)?` +
                `(today|tomorrow|(?:\\d{1,2}\\s+[a-z]+(?:\\s+\\d{4})?)|(?:[a-z]+\\s+\\d{1,2}(?:\\s+\\d{4})?))` +
                `\\s+)?` +
                `(${mealWords})` +
                `\\s+(?:is|to|as|will be|menu is|should be)?\\s*` +
                `(.+)`,
                "i"
            )
        );
        if (menuSetMatch) {
            const dateStr = (menuSetMatch[1] || "today").trim().replace(/[.,!?]+$/, "");
            const meal = menuSetMatch[2].toLowerCase();
            const food = menuSetMatch[3].trim().replace(/[.,!?]+$/, "");
            console.log("[LocalParser] set_menu (single):", { dateStr, meal, food });
            return { intent: "set_menu", entity: "menu", parameters: { dateStr, meal, food } };
        }

        // --- Menu: edit (open dialog) ---
        if (isAction("edit|modify|change|update", "menu|food")) {
            return { intent: "edit_menu", entity: "menu", parameters: {} };
        }

        // --- Filter commands ---
        // "show pending passes" / "show approved passes" / "show rejected passes"
        const filterPassMatch = rawText.match(/\b(?:show|view|filter|display)\s+(pending|approved|rejected)\s+(?:pass|passes|request|requests)\b/i);
        if (filterPassMatch) {
            return { intent: "filter_passes", entity: "pass", parameters: { status: filterPassMatch[1].toLowerCase() } };
        }
        // "show pending complaints" / "show resolved complaints" / "show in progress complaints"
        const filterComplaintMatch = rawText.match(/\b(?:show|view|filter|display)\s+(pending|in[\s_-]?progress|resolved)\s+(?:complaint|complaints|problem|problems|issue|issues)\b/i);
        if (filterComplaintMatch) {
            const status = filterComplaintMatch[1].toLowerCase().replace(/[\s-]/g, "_").replace("in_progress", "in_progress");
            return { intent: "filter_complaints", entity: "complaint", parameters: { status } };
        }

        // --- Scroll ---
        if (has("scroll down|page down|scroll bottom")) return { intent: "scroll", entity: "navigation", parameters: { direction: "down" } };
        if (has("scroll up|page up|scroll top")) return { intent: "scroll", entity: "navigation", parameters: { direction: "up" } };

        // 2. NAVIGATION (Keyword-based / Fuzzy)
        const isNavPrefix = /\b(go to|open|show|take me to|navigate to|any|view)\b/i.test(rawText);
        
        // Find best matching intent from KEYWORD_MAP
        let bestIntent = "unknown";
        let maxScore = 0;

        for (const [intent, keywords] of Object.entries(KEYWORD_MAP)) {
            for (const kw of keywords) {
                // Check each token against each keyword
                for (const token of tokens) {
                    const score = getSimilarity(token, kw);
                    if (score > maxScore) {
                        maxScore = score;
                        bestIntent = intent;
                    }
                }
            }
        }

        if (maxScore > 0.75) {
            // Mapping keyword categories to actual page names used in route mapping
            const pageMap: Record<string, string> = {
                complaints: "complaints",
                passes: "passes",
                notices: "notices",
                dashboard: "dashboard",
                attendance: "attendance",
                menu: "menu",
                students: "students",
                profile: "profile",
                rooms: "dashboard",
                history: "history",
                resolved_complaints: "resolved_complaints"
            };
            result = { 
                intent: "navigate", 
                entity: "page", 
                parameters: { 
                    page: pageMap[bestIntent] || bestIntent,
                    keyword: bestIntent,
                    score: maxScore
                } 
            };
        }

        // If navigated but no prefix and text is long, downgrade to unknown to prevent false triggers
        if (result.intent === "navigate" && !isNavPrefix && rawText.split(" ").length > 3) {
            console.log("[LocalParser] Downgrading long ambiguous sentence to unknown");
            return { intent: "unknown", entity: "none", parameters: {} };
        }

        // 3. UTILITIES
        if (has("logout|sign out|sign-out")) return { intent: "logout", entity: "session", parameters: {} };
        if (has("back|previous|return")) return { intent: "go_back", entity: "navigation", parameters: {} };
        if (has("refresh|reload")) return { intent: "refresh", entity: "navigation", parameters: {} };
        
        // Theme
        if (has("dark mode|dark theme|night mode")) return { intent: "switch_theme", entity: "ui", parameters: { theme: "dark" } };
        if (has("light mode|light theme|day mode")) return { intent: "switch_theme", entity: "ui", parameters: { theme: "light" } };
        if (has("switch theme|toggle theme|change theme")) return { intent: "switch_theme", entity: "ui", parameters: { theme: "toggle" } };

        // Search
        const searchMatch = rawText.match(/\b(?:search|find|look for)\s+(?:for\s+)?(.+)/i);
        if (searchMatch) return { intent: "search", entity: "data", parameters: { query: searchMatch[1].trim() } };

        if (has("help|tutorial|support|what can i say|show commands")) return { intent: "help", entity: "help", parameters: {} };

        return result;
    };

    const handleNavigation = useCallback(async (command: string) => {
        const text = command.toLowerCase().trim().replace(/[.,!?]+$/, "");
        console.log("🎤 Voice Command:", text);
        setVoiceStatus({ title: "Thinking...", message: `"${text}"`, type: "info" });

        // Always compute local result for comparison/fallback
        const localResult = localIntentParser(text);
        console.log("🔧 Local parser result:", JSON.stringify(localResult));

        let result;
        try {
            // Try Calling AI Intent Parser Edge Function
            const { data: sessionData } = await supabase.auth.getSession();
            const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-intent-parser`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${sessionData.session?.access_token}`,
                    },
                    body: JSON.stringify({ text }),
                }
            );

            if (response.ok) {
                result = await response.json();
                console.log("✅ AI Result:", JSON.stringify(result));

                // If AI returns unknown OR an intent we don't have a handler for, use local
                if (!result || result.intent === "unknown" || !commandHandlers[result.intent]) {
                    console.log("⚠️ AI returned unusable result, using local parser instead");
                    result = localResult;
                }
            } else {
                const errorText = await response.text();
                console.warn("❌ AI Edge Function error:", response.status, errorText);
                result = localResult;
            }
        } catch (error) {
            console.warn("🚨 Local/Network fallback triggered:", error);
            result = localResult;
        }

        console.log("🎯 Final Intent Decided:", JSON.stringify(result));

        if (result && result.intent !== "unknown") {
            const handler = commandHandlers[result.intent];
            if (handler) {
                await handler(result.parameters);
                setVoiceStatus({
                    title: "Success",
                    message: `Recognized: "${text}"`,
                    type: "success"
                });
            } else {
                setVoiceStatus({
                    title: "Unknown Command",
                    message: "Sorry, I couldn't understand that command.",
                    type: "error"
                });
                speakResponse("Sorry, I couldn't understand that command.");
            }
        } else {
            setVoiceStatus({
                title: "Unknown Command",
                message: "Sorry, I couldn't understand that command.",
                type: "error"
            });
            speakResponse("Sorry, I couldn't understand that command.");
        }

        // Clear success/error status after 3 seconds
        setTimeout(() => setVoiceStatus(null), 3500);
    }, [navigate, isAdmin, signOut, speakResponse]);

    const toggleListening = () => {
        if (!isSupported) {
            toast({
                title: "Voice Not Supported",
                description: "Voice features require Chrome or Safari (iOS).",
                variant: "destructive",
            });
            return;
        }

        if (isListening) {
            stopListening();
            return;
        }

        const recognition = new window.webkitSpeechRecognition();
        recognitionRef.current = recognition;
        
        // --- PRO OPTIMIZATION: Grammar & Locale ---
        recognition.lang = "en-IN"; // Better for Indian accents and common terms
        recognition.continuous = true;
        recognition.interimResults = true;

        if ("webkitSpeechGrammarList" in window) {
            const grammar = "#JSGF V1.0; grammar hostel; public <item> = hostel | buddy | gatepass | complaint | notice | attendance | idli | dosa | poori | biryani | karthik | ravi | sai | present | absent | admin | student | user ;";
            const speechRecognitionList = new window.webkitSpeechGrammarList();
            speechRecognitionList.addFromString(grammar, 1);
            recognition.grammars = speechRecognitionList;
        }

        recognition.onstart = () => {
            setIsListening(true);
            setTranscribedText("");
            setVoiceStatus({ title: "Listening...", message: "Waiting for your command...", type: "info" });
        };

        recognition.onresult = (event: SpeechRecognitionEvent) => {
            let interimTranscript = "";
            let finalTranscript = "";

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            const currentText = (finalTranscript || interimTranscript).trim();
            if (currentText) {
                setTranscribedText(currentText);
                setVoiceStatus({ title: "Listening...", message: `"${currentText}"`, type: "info" });

                if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
                silenceTimeoutRef.current = setTimeout(() => {
                    handleNavigation(currentText);
                    stopListening();
                }, 1500);
            }
        };

        recognition.onerror = (event: any) => {
            console.warn("🎤 Voice Error:", event.error);
            if (event.error === "no-speech") return;
            
            let title = "Voice Error";
            let message = "Could not recognize voice.";
            
            if (event.error === "network") {
                title = "Network Issue";
                message = "Voice recognition requires a stable internet connection.";
            } else if (event.error === "not-allowed") {
                message = "Microphone access denied. Please enable it in settings.";
            }

            setVoiceStatus({ title, message, type: "error" });
            toast({ title, description: message, variant: "destructive" });
            stopListening();
        };

        recognition.onend = () => {
            // Automatically restart if we're still in listening mode (handled in stopListening loop)
            if (isListening && recognitionRef.current) {
                try {
                    recognitionRef.current.start();
                } catch (e) {
                    // Already running
                }
            } else {
                setIsListening(false);
            }
        };

        recognition.start();
    };

    const stopListening = () => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
        }
        if (silenceTimeoutRef.current) {
            clearTimeout(silenceTimeoutRef.current);
        }
        setIsListening(false);
    };

    if (!isSupported) return null;

    return createPortal(
        <div className="fixed inset-0 pointer-events-none z-[9999] flex items-end justify-end p-6 sm:p-10">
            <div className="flex flex-col items-end gap-4 pointer-events-auto">
                {/* Status Overlay - Now appears TOP of the button */}
                {(isListening || voiceStatus) && (
                    <div
                        className={cn(
                            "whitespace-nowrap rounded-2xl p-4 shadow-2xl border animate-in fade-in slide-in-from-bottom-4 zoom-in duration-300 max-w-[280px]",
                            voiceStatus?.type === "error" ? "bg-destructive text-destructive-foreground border-destructive/20" :
                                voiceStatus?.type === "success" ? "bg-green-600 text-white border-green-500/20" :
                                    "bg-card border-primary/20"
                        )}
                    >
                        <span className="flex items-center gap-3">
                            {isListening && voiceStatus?.type === "info" && (
                                <AudioVisualizer isListening={isListening} />
                            )}
                            <div className="flex flex-col">
                                <span className={cn(
                                    "text-sm font-bold",
                                    (voiceStatus?.type === "error" || voiceStatus?.type === "success") ? "text-white" : "bg-gradient-to-r from-primary to-green-600 bg-clip-text text-transparent"
                                )}>
                                    {voiceStatus?.title || "Listening..."}
                                </span>
                                <span className={cn(
                                    "text-xs font-normal mt-1 leading-relaxed whitespace-pre-wrap",
                                    (voiceStatus?.type === "error" || voiceStatus?.type === "success") ? "text-white/90" : "text-muted-foreground"
                                )}>
                                    {voiceStatus?.message}
                                </span>
                            </div>
                        </span>
                    </div>
                )}

                <div className="relative">
                    {isListening && (
                        <>
                            <div className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />
                            <div className="absolute -inset-4 animate-pulse rounded-full bg-red-500/10" />
                        </>
                    )}
                    <Button
                        onClick={toggleListening}
                        size="icon"
                        className={cn(
                            "h-16 w-16 rounded-full shadow-2xl transition-all duration-500 hover:scale-110 active:scale-95",
                            isListening
                                ? "bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.5)] hover:bg-red-600"
                                : "bg-primary shadow-[0_0_20px_rgba(34,197,94,0.3)] hover:bg-primary/90"
                        )}
                        title={isListening ? "Stop AI Listening" : "Smart AI Voice Navigation"}
                    >
                        {isListening ? (
                            <div className="relative flex items-center justify-center">
                                <Loader2 className="h-8 w-8 animate-spin text-white/20" />
                                <Mic className="absolute h-7 w-7 text-white animate-bounce" />
                            </div>
                        ) : (
                            <Mic className="h-7 w-7 text-white" />
                        )}
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    );
}
