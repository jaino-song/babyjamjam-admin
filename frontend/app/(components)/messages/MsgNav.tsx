"use client";
import { Button, Paper, Stack } from "@mui/material";
import { t, Locale } from "@/app/lib/i18n/translations";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale } from "@/app/(components)/LocaleProvider";

interface NavButton {
  id: string;
  labelKey: string;
  href: string;
}

const navButtonConfigs: NavButton[] = [
  { id: "greeting", labelKey: "msg-type.greeting", href: "/messages/greeting" },
  { id: "service-info", labelKey: "msg-type.service-info", href: "/messages/service-info" },
  { id: "price-info", labelKey: "msg-type.price-info", href: "/messages/price-info" },
  { id: "reminder", labelKey: "msg-type.reminder", href: "/messages/reminder" },
  { id: "thanks", labelKey: "msg-type.thanks", href: "/messages/thanks" },
  { id: "survey", labelKey: "msg-type.survey", href: "/messages/survey" },
  { id: "contract", labelKey: "msg-type.contract", href: "/messages/contract" },
];

const getNavButtons = (locale: Locale) =>
  navButtonConfigs.map((config) => ({
    ...config,
    label: t(locale, config.labelKey),
  }));

export const MsgNav = () => {
  const locale = useLocale();
  const pathname = usePathname();
  const navButtons = getNavButtons(locale);

  return (
    <Paper
      elevation={2}
      data-component="messages-nav"
      sx={{
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        borderRadius: "20px 20px 0 0",
        overflow: "hidden",
        bgcolor: "background.default",
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