import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Coffee, Sun, Moon, Plus, Edit2, UtensilsCrossed, RefreshCw, ArrowLeft, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format, addDays, startOfWeek, isToday, isSameDay } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface DayMenu {
  id?: string;
  menu_date: string;
  breakfast: string | null;
  lunch: string | null;
  dinner: string | null;
}

export default function Menu() {
  const { isAdmin, profile } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [weeklyMenu, setWeeklyMenu] = useState<DayMenu[]>([]);
  const [editingDay, setEditingDay] = useState<DayMenu | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requestedDateMenu, setRequestedDateMenu] = useState<DayMenu | null>(null);
  const [requestedDateStr, setRequestedDateStr] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    breakfast: "",
    lunch: "",
    dinner: "",
  });

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchWeeklyMenu();
    setRefreshing(false);
  };

  // Fetch menu for a specific requested date (from voice command URL param)
  const fetchRequestedDateMenu = useCallback(async (dateParam: string) => {
    setRequestedDateStr(dateParam);
    const { data } = await supabase
      .from("food_menu")
      .select("*")
      .eq("menu_date", dateParam)
      .maybeSingle();

    if (data) {
      setRequestedDateMenu(data);
    } else {
      setRequestedDateMenu({
        menu_date: dateParam,
        breakfast: null,
        lunch: null,
        dinner: null,
      });
    }
  }, []);

  // Read ?date= query param
  useEffect(() => {
    const dateParam = searchParams.get("date");
    if (dateParam) {
      fetchRequestedDateMenu(dateParam);
    } else {
      setRequestedDateMenu(null);
      setRequestedDateStr(null);
    }
  }, [searchParams, fetchRequestedDateMenu]);

  const clearRequestedDate = () => {
    setRequestedDateMenu(null);
    setRequestedDateStr(null);
    setSearchParams({});
  };

  useEffect(() => {
    fetchWeeklyMenu();

    // Voice task listener for Menu
    const handleVoiceTask = (e: any) => {
      const { action, target } = e.detail;
      if (target !== "menu" || !isAdmin) return;

      // Clear the pending task since we're handling it
      if ((window as any).__pendingVoiceTask?.target === "menu") {
        (window as any).__pendingVoiceTask = null;
      }

      if (action === "edit") {
        handleEditClick(new Date());
      } else if (action === "resolve") {
        handleSaveMenu();
      }
    };

    window.addEventListener("voicetask", handleVoiceTask);

    // Realtime subscription — auto-refresh on any DB change
    const channel = supabase
      .channel("menu-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "food_menu" }, () => {
        fetchWeeklyMenu();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("voicetask", handleVoiceTask);
    };
  }, [isAdmin, editingDay, formData, profile?.id]);

  // Check for pending voice tasks when menu data loads
  useEffect(() => {
    if (weeklyMenu.length === 0) return;
    const pending = (window as any).__pendingVoiceTask;
    if (pending && pending.target === "menu") {
      (window as any).__pendingVoiceTask = null;
      window.dispatchEvent(new CustomEvent("voicetask", { detail: pending }));
    }
  }, [weeklyMenu]);

  const fetchWeeklyMenu = async () => {
    const startDate = format(weekStart, "yyyy-MM-dd");
    const endDate = format(addDays(weekStart, 6), "yyyy-MM-dd");

    const { data } = await supabase
      .from("food_menu")
      .select("*")
      .gte("menu_date", startDate)
      .lte("menu_date", endDate)
      .order("menu_date");

    if (data) {
      setWeeklyMenu(data);
    }
  };

  const getMenuForDate = (date: Date): DayMenu | undefined => {
    return weeklyMenu.find((m) =>
      isSameDay(new Date(m.menu_date), date)
    );
  };

  const handleEditClick = (date: Date) => {
    const existingMenu = getMenuForDate(date);
    setEditingDay({
      id: existingMenu?.id,
      menu_date: format(date, "yyyy-MM-dd"),
      breakfast: existingMenu?.breakfast || null,
      lunch: existingMenu?.lunch || null,
      dinner: existingMenu?.dinner || null,
    });
    setFormData({
      breakfast: existingMenu?.breakfast || "",
      lunch: existingMenu?.lunch || "",
      dinner: existingMenu?.dinner || "",
    });
    setDialogOpen(true);
  };

  const handleSaveMenu = async () => {
    if (!editingDay || !profile?.id) return;

    const menuData = {
      menu_date: editingDay.menu_date,
      breakfast: formData.breakfast || null,
      lunch: formData.lunch || null,
      dinner: formData.dinner || null,
      created_by: profile.id,
    };

    let error;
    if (editingDay.id) {
      const result = await supabase
        .from("food_menu")
        .update(menuData)
        .eq("id", editingDay.id);
      error = result.error;
    } else {
      const result = await supabase.from("food_menu").insert(menuData);
      error = result.error;
    }

    if (error) {
      toast({
        title: "Error",
        description: "Failed to save menu. Please try again.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Success",
        description: "Menu updated successfully.",
      });
      setDialogOpen(false);
      fetchWeeklyMenu();
    }
  };

  const todayMenu = getMenuForDate(new Date());

  // Determine which menu to show in the top card
  const displayMenu = requestedDateMenu || todayMenu;
  const displayDate = requestedDateStr
    ? new Date(requestedDateStr + "T00:00:00")
    : new Date();
  const isRequestedDate = !!requestedDateStr;
  const isDisplayToday = isToday(displayDate);

  return (
    <div className="space-y-6">
      {/* Requested / Today's Menu Card */}
      <Card className="card-shadow overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-primary to-primary/80 text-primary-foreground">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {isRequestedDate && !isDisplayToday ? (
                <CalendarDays className="h-5 w-5" />
              ) : (
                <UtensilsCrossed className="h-5 w-5" />
              )}
              {isRequestedDate && !isDisplayToday
                ? `Menu for ${format(displayDate, "EEEE, MMM d")}`
                : "Today's Menu"}
            </CardTitle>
            <div className="flex items-center gap-2">
              {isRequestedDate && !isDisplayToday && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-primary-foreground hover:bg-primary-foreground/10 gap-1"
                  onClick={clearRequestedDate}
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Today
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="text-primary-foreground hover:bg-primary-foreground/10"
                onClick={handleRefresh}
                disabled={refreshing}
                title="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
              <Badge className="bg-primary-foreground/20 text-primary-foreground">
                {format(displayDate, "EEEE, MMM d")}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {displayMenu && (displayMenu.breakfast || displayMenu.lunch || displayMenu.dinner) ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-4 dark:bg-amber-900/20">
                <Coffee className="h-6 w-6 text-amber-600" />
                <div>
                  <p className="font-medium text-amber-900 dark:text-amber-100">
                    Breakfast
                  </p>
                  <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
                    {displayMenu.breakfast || "Not updated"}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl bg-orange-50 p-4 dark:bg-orange-900/20">
                <Sun className="h-6 w-6 text-orange-500" />
                <div>
                  <p className="font-medium text-orange-900 dark:text-orange-100">
                    Lunch
                  </p>
                  <p className="mt-1 text-sm text-orange-800 dark:text-orange-200">
                    {displayMenu.lunch || "Not updated"}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl bg-indigo-50 p-4 dark:bg-indigo-900/20">
                <Moon className="h-6 w-6 text-indigo-500" />
                <div>
                  <p className="font-medium text-indigo-900 dark:text-indigo-100">
                    Dinner
                  </p>
                  <p className="mt-1 text-sm text-indigo-800 dark:text-indigo-200">
                    {displayMenu.dinner || "Not updated"}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <UtensilsCrossed className="h-12 w-12 text-muted-foreground" />
              <p className="mt-2 text-lg font-medium text-muted-foreground">
                {isRequestedDate && !isDisplayToday
                  ? `No menu set for ${format(displayDate, "EEEE, MMM d")}`
                  : "Menu not updated yet"}
              </p>
              {isAdmin && (
                <Button
                  className="mt-4"
                  onClick={() => handleEditClick(displayDate)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {isRequestedDate && !isDisplayToday
                    ? `Add Menu for ${format(displayDate, "MMM d")}`
                    : "Add Today's Menu"}
                </Button>
              )}
              {isRequestedDate && !isDisplayToday && (
                <Button
                  variant="ghost"
                  className="mt-2"
                  onClick={clearRequestedDate}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Today
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weekly Menu */}
      <Card className="card-shadow">
        <CardHeader>
          <CardTitle>Weekly Menu</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion
            type="single"
            collapsible
            defaultValue={format(new Date(), "yyyy-MM-dd")}
            className="space-y-2"
          >
            {weekDays.map((day) => {
              const menu = getMenuForDate(day);
              const dayIsToday = isToday(day);
              const dateStr = format(day, "yyyy-MM-dd");

              return (
                <AccordionItem
                  key={dateStr}
                  value={dateStr}
                  className={cn(
                    "rounded-lg border px-4",
                    dayIsToday && "bg-[hsl(var(--today-highlight))] border-primary/30"
                  )}
                >
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold">
                        {format(day, "EEEE")}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {format(day, "MMM d")}
                      </span>
                      {dayIsToday && (
                        <Badge variant="default" className="ml-2">
                          Today
                        </Badge>
                      )}
                      {!menu && (
                        <Badge variant="secondary" className="ml-2">
                          No Menu
                        </Badge>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-4">
                    {menu ? (
                      <div className="space-y-3">
                        <div className="flex items-start gap-3">
                          <Coffee className="h-5 w-5 text-amber-600" />
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              Breakfast
                            </p>
                            <p className="text-sm">
                              {menu.breakfast || "Not updated"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <Sun className="h-5 w-5 text-orange-500" />
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              Lunch
                            </p>
                            <p className="text-sm">
                              {menu.lunch || "Not updated"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <Moon className="h-5 w-5 text-indigo-500" />
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">
                              Dinner
                            </p>
                            <p className="text-sm">
                              {menu.dinner || "Not updated"}
                            </p>
                          </div>
                        </div>
                        {isAdmin && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditClick(day)}
                            className="mt-2"
                          >
                            <Edit2 className="mr-2 h-4 w-4" />
                            Edit Menu
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="py-4 text-center">
                        <p className="text-muted-foreground">
                          Menu not updated yet
                        </p>
                        {isAdmin && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditClick(day)}
                            className="mt-2"
                          >
                            <Plus className="mr-2 h-4 w-4" />
                            Add Menu
                          </Button>
                        )}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>

      {/* Edit Menu Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingDay?.id ? "Edit" : "Add"} Menu for{" "}
              {editingDay && format(new Date(editingDay.menu_date), "EEEE, MMM d")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="breakfast">Breakfast</Label>
              <Textarea
                id="breakfast"
                placeholder="Enter breakfast items..."
                value={formData.breakfast}
                onChange={(e) =>
                  setFormData({ ...formData, breakfast: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lunch">Lunch</Label>
              <Textarea
                id="lunch"
                placeholder="Enter lunch items..."
                value={formData.lunch}
                onChange={(e) =>
                  setFormData({ ...formData, lunch: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dinner">Dinner</Label>
              <Textarea
                id="dinner"
                placeholder="Enter dinner items..."
                value={formData.dinner}
                onChange={(e) =>
                  setFormData({ ...formData, dinner: e.target.value })
                }
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveMenu}>Save Menu</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
