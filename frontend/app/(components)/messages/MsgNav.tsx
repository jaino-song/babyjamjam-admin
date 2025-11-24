"use client";
import { Button, Paper, Stack } from "@mui/material";
import { t } from "@/app/lib/i18n/translations";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavButton {
  id: string;
  label: string;
  href: string;
}

const navButtons: NavButton[] = [
  { id: "greeting", label: t("ko", "msg-type.greeting"), href: "/messages/greeting" },
  { id: "service-info", label: t("ko", "msg-type.service-info"), href: "/messages/service-info" },
  { id: "price-info", label: t("ko", "msg-type.price-info"), href: "/messages/price-info" },
  { id: "reminder", label: t("ko", "msg-type.reminder"), href: "/messages/reminder" },
  { id: "thanks", label: t("ko", "msg-type.thanks"), href: "/messages/thanks" },
  { id: "survey", label: t("ko", "msg-type.survey"), href: "/messages/survey" },
  { id: "contract", label: t("ko", "msg-type.contract"), href: "/messages/contract" },
];

export const MsgNav = () => {
  const pathname = usePathname();
  console.log(pathname);

  return (
    <Paper
      elevation={2}
      sx={{
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        borderRadius: "20px 20px 0 0",
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        sx={{
          flexWrap: "wrap",
        }}
      >
        {navButtons.map((button) => (
          <Button
            key={button.id}
            component={Link}
            href={button.href}
            variant={pathname === button.href ? "contained" : "outlined"}
            sx={{
              borderRadius: 0,
              border: "none",
              textTransform: "none",
              fontSize: "0.875rem",
              whiteSpace: "nowrap",
              flexGrow: 1,
              py: 1.5,
              px: 1,
              minWidth: "20%",
              textDecoration: "none",
              "&:hover": {
                borderTop: "none",
                borderLeft: "none",
                borderRight: "none",
                boxShadow: "none",
              },
              "&.Mui-selected": {
                borderTop: "none",
                borderLeft: "none",
                borderRight: "none",
                color: "blue",
              },
            }}
          >
            {button.label}
          </Button>
        ))}
      </Stack>
    </Paper>
  );
}