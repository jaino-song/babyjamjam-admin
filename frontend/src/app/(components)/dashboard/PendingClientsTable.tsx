"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { pendingClients } from "@/app/data/mockData";
import { ChevronDown, Phone, MapPin, FileText } from "lucide-react";

export function PendingClientsTable() {
  const [openRows, setOpenRows] = useState<Set<number>>(new Set());

  const toggleRow = (id: number) => {
    setOpenRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  return (
    <Card className="opacity-0 animate-fade-in" style={{ animationDelay: "300ms" }}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold">대기 중 고객</CardTitle>
        <Badge variant="secondary" className="text-xs">
          {pendingClients.length}명
        </Badge>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table className="min-w-[300px]">
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap w-8"></TableHead>
              <TableHead className="whitespace-nowrap">이름</TableHead>
              <TableHead className="whitespace-nowrap">시작 날짜</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pendingClients.map((client, index) => (
              <Collapsible
                key={client.id}
                open={openRows.has(client.id)}
                onOpenChange={() => toggleRow(client.id)}
                asChild
              >
                <>
                  <CollapsibleTrigger asChild>
                    <TableRow
                      className={cn(
                        "cursor-pointer transition-all duration-200",
                        "hover:bg-muted/50",
                        "opacity-0 animate-fade-in",
                        openRows.has(client.id) && "bg-muted/30"
                      )}
                      style={{ animationDelay: `${350 + index * 50}ms` }}
                    >
                      <TableCell className="w-8">
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform duration-200",
                            openRows.has(client.id) && "rotate-180"
                          )}
                        />
                      </TableCell>
                      <TableCell className="font-medium whitespace-nowrap">
                        {client.name}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {client.startDate}
                      </TableCell>
                    </TableRow>
                  </CollapsibleTrigger>
                  <CollapsibleContent asChild>
                    <TableRow className="bg-muted/20 hover:bg-muted/30">
                      <TableCell colSpan={3} className="p-0">
                        <div className="px-4 py-3 space-y-2 animate-fade-in">
                          <div className="flex items-center gap-2 text-sm flex-wrap">
                            <Badge variant="outline" className="text-xs">
                              {client.type}
                            </Badge>
                            {client.careCenter && (
                              <Badge variant="outline" className="text-xs">
                                조리원 이용
                              </Badge>
                            )}
                            {client.breastPump && (
                              <Badge variant="outline" className="text-xs">
                                유축기 대여
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Phone className="h-3.5 w-3.5" />
                            <span>{client.phone}</span>
                          </div>
                          <div className="flex items-start gap-2 text-sm text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span>{client.address}</span>
                          </div>
                          <div className="flex items-start gap-2 text-sm text-muted-foreground">
                            <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span>{client.notes}</span>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  </CollapsibleContent>
                </>
              </Collapsible>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
