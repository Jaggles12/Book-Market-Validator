import React from "react";

export function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100 flex justify-center items-start pt-0 md:pt-8 pb-0 md:pb-8">
      <div className="w-full max-w-md bg-background min-h-screen md:min-h-[800px] md:h-[800px] md:rounded-[3rem] md:shadow-2xl overflow-hidden flex flex-col relative border-x border-border/40 md:border">
        {/* Status Bar Area (Visual Only for desktop feel) */}
        <div className="h-12 w-full bg-background/80 backdrop-blur-md absolute top-0 left-0 z-50 flex items-center justify-between px-6 text-xs font-medium text-foreground/60 select-none">
          <span>9:41</span>
          <div className="flex gap-1.5 items-center">
            <div className="h-2.5 w-2.5 rounded-full bg-foreground/20"></div>
            <div className="h-2.5 w-2.5 rounded-full bg-foreground/20"></div>
            <div className="h-2.5 w-4 rounded-full bg-foreground/20"></div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto no-scrollbar pt-14 pb-8">
            {children}
        </div>

        {/* Bottom Indicator (Home Bar) */}
        <div className="absolute bottom-0 left-0 w-full h-6 bg-gradient-to-t from-background to-transparent flex justify-center items-end pb-2 pointer-events-none">
          <div className="w-32 h-1 bg-foreground/20 rounded-full"></div>
        </div>
      </div>
    </div>
  );
}
