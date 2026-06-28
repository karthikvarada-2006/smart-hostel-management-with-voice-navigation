import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  GraduationCap,
  Shield,
  Building2,
  ClipboardCheck,
  Ticket,
  MessageSquare,
  UtensilsCrossed,
  Lock,
  Users,
  UserCog,
  ChevronDown,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Navigation Header */}
      <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Building2 className="h-5 w-5" />
            </div>
            <span className="text-xl font-bold text-primary">Hostel Hub</span>
          </div>

          <nav className="flex items-center gap-4">
            <a href="#about" className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:block">
              About
            </a>
            <a href="#features" className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:block">
              Features
            </a>
            <a href="#users" className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:block">
              Users
            </a>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="default" className="gap-2">
                  Sign In
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem asChild>
                  <Link to="/student/login" className="flex items-center gap-2 cursor-pointer">
                    <GraduationCap className="h-4 w-4" />
                    Student Sign In
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/login" className="flex items-center gap-2 cursor-pointer">
                    <Shield className="h-4 w-4" />
                    Admin Sign In
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-accent/20 to-primary/10 py-20 md:py-32">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
        <div className="container relative mx-auto px-4 text-center">
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-xl shadow-primary/25">
            <Building2 className="h-10 w-10" />
          </div>
          <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground md:text-6xl lg:text-7xl">
            Welcome to{" "}
            <span className="bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
              Hostel Hub
            </span>
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg text-muted-foreground md:text-xl">
            A complete hostel management solution for students and administrators. 
            Streamline attendance, passes, complaints, and more — all in one place.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button asChild size="lg" className="gap-3 px-10 py-4 text-base">
              <Link to="/student/login">
                Get Started as Student
                <ArrowRight className="h-5 w-5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-3 px-10 py-4 text-base">
              <Link to="/admin/login">
                Admin Portal
                <Shield className="h-5 w-5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section id="about" className="scroll-mt-20 py-20 md:py-28">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
              About Hostel Management
            </h2>
            <p className="mb-8 text-muted-foreground">
              Understanding the need for digital hostel operations
            </p>
          </div>

          <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
            <Card className="border-2 transition-all duration-300 hover:border-primary/50 hover:shadow-lg">
              <CardHeader>
                <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Building2 className="h-6 w-6" />
                </div>
                <CardTitle>What is a Hostel Management System?</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                <p>
                  A Hostel Management System is a comprehensive digital platform designed to 
                  automate and streamline all administrative tasks related to hostel operations. 
                  It replaces manual record-keeping with efficient digital processes, making 
                  management seamless for both administrators and residents.
                </p>
              </CardContent>
            </Card>

            <Card className="border-2 transition-all duration-300 hover:border-primary/50 hover:shadow-lg">
              <CardHeader>
                <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <GraduationCap className="h-6 w-6" />
                </div>
                <CardTitle>Why is it Useful for Colleges?</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                <p>
                  Colleges benefit from reduced paperwork, real-time tracking of student 
                  activities, automated attendance management, and faster complaint resolution. 
                  It enhances transparency, improves communication between students and staff, 
                  and ensures better safety through digital pass management.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="scroll-mt-20 bg-muted/30 py-20 md:py-28">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
              Powerful Features
            </h2>
            <p className="mb-12 text-muted-foreground">
              Everything you need to manage hostel operations efficiently
            </p>
          </div>

          <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: ClipboardCheck,
                title: "Attendance Management",
                description: "Track student attendance digitally with automated daily records and instant reporting.",
              },
              {
                icon: Ticket,
                title: "Pass Requests & Approvals",
                description: "Students can request outing or vacation passes online. Admins approve with a single click.",
              },
              {
                icon: MessageSquare,
                title: "Complaint Management",
                description: "Submit and track complaints digitally. Prioritize issues and resolve them faster.",
              },
              {
                icon: UtensilsCrossed,
                title: "Food Menu Updates",
                description: "View daily food menus with breakfast, lunch, and dinner details updated by administration.",
              },
              {
                icon: Lock,
                title: "Secure Role-Based Access",
                description: "Separate portals for students and admins with secure authentication and authorization.",
              },
              {
                icon: Users,
                title: "Student Directory",
                description: "Admins can view and manage all registered students with room and hostel information.",
              },
            ].map((feature) => (
              <Card key={feature.title} className="group border-2 transition-all duration-300 hover:border-primary/50 hover:shadow-lg">
                <CardHeader>
                  <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <CardTitle className="text-lg">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">{feature.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Who Can Use It Section */}
      <section id="users" className="scroll-mt-20 py-20 md:py-28">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
              Who Can Use It?
            </h2>
            <p className="mb-12 text-muted-foreground">
              Designed for both students and administrators
            </p>
          </div>

          <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
            {/* Student Benefits */}
            <Card className="relative overflow-hidden border-2 transition-all duration-300 hover:border-primary hover:shadow-xl">
              <div className="absolute right-0 top-0 h-32 w-32 translate-x-8 translate-y-[-50%] rounded-full bg-primary/10" />
              <CardHeader className="relative">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                  <GraduationCap className="h-8 w-8" />
                </div>
                <CardTitle className="text-2xl">For Students</CardTitle>
                <CardDescription className="text-base">
                  Access all hostel services from your device
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {[
                    "View attendance records anytime",
                    "Request passes with just a few clicks",
                    "Submit and track complaints online",
                    "Check daily food menu",
                    "Receive notifications on updates",
                  ].map((benefit) => (
                    <li key={benefit} className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <span className="text-muted-foreground">{benefit}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-6 w-full" size="lg">
                  <Link to="/student/register">Register as Student</Link>
                </Button>
              </CardContent>
            </Card>

            {/* Admin Benefits */}
            <Card className="relative overflow-hidden border-2 transition-all duration-300 hover:border-secondary hover:shadow-xl">
              <div className="absolute right-0 top-0 h-32 w-32 translate-x-8 translate-y-[-50%] rounded-full bg-secondary/20" />
              <CardHeader className="relative">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground shadow-lg">
                  <UserCog className="h-8 w-8" />
                </div>
                <CardTitle className="text-2xl">For Administrators</CardTitle>
                <CardDescription className="text-base">
                  Complete control over hostel operations
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {[
                    "Mark and manage student attendance",
                    "Approve or reject pass requests instantly",
                    "Handle complaints with priority levels",
                    "Update food menu daily",
                    "Manage all students in one place",
                  ].map((benefit) => (
                    <li key={benefit} className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-secondary-foreground" />
                      <span className="text-muted-foreground">{benefit}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild variant="secondary" className="mt-6 w-full" size="lg">
                  <Link to="/admin/register">Register as Admin</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-r from-primary to-primary/80 py-16 md:py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-4 text-3xl font-bold text-primary-foreground md:text-4xl">
            Ready to Get Started?
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-primary-foreground/80">
            Join Hostel Hub today and experience seamless hostel management.
          </p>
          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Button asChild size="lg" variant="secondary" className="gap-2 px-8">
              <Link to="/student/login">
                <GraduationCap className="h-4 w-4" />
                Student Sign In
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="gap-2 border-primary-foreground/20 bg-transparent px-8 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
              <Link to="/admin/login">
                <Shield className="h-4 w-4" />
                Admin Sign In
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-card py-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Building2 className="h-4 w-4" />
              </div>
              <span className="font-semibold text-foreground">Hostel Hub</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2024 Hostel Hub. Built for college project demonstration.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
