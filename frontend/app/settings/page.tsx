"use client";

import { Box, Container, Typography, Tabs, Tab, Paper } from "@mui/material";
import { useState } from "react";
import SettingsIcon from "@mui/icons-material/Settings";
import AttachMoneyIcon from "@mui/icons-material/AttachMoney";
import { VoucherPriceUploadForm } from "@/app/(components)/settings/VoucherPriceUploadForm";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index, ...other }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`settings-tabpanel-${index}`}
      aria-labelledby={`settings-tab-${index}`}
      {...other}
    >
      {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `settings-tab-${index}`,
    "aria-controls": `settings-tabpanel-${index}`,
  };
}

export default function SettingsPage() {
  const [tabValue, setTabValue] = useState(0);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* 페이지 헤더 */}
      <Box sx={{ mb: 4, display: "flex", alignItems: "center", gap: 2 }}>
        <SettingsIcon sx={{ fontSize: 32, color: "primary.main" }} />
        <Typography variant="h4" component="h1">
          설정
        </Typography>
      </Box>

      {/* 탭 네비게이션 */}
      <Paper elevation={1} sx={{ mb: 2 }}>
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          aria-label="설정 탭"
          sx={{ borderBottom: 1, borderColor: "divider" }}
        >
          <Tab
            icon={<AttachMoneyIcon />}
            iconPosition="start"
            label="바우처 요금표"
            {...a11yProps(0)}
          />
          {/* 추가 탭은 필요에 따라 여기에 추가 */}
        </Tabs>
      </Paper>

      {/* 탭 컨텐츠 */}
      <TabPanel value={tabValue} index={0}>
        <VoucherPriceUploadForm />
      </TabPanel>
    </Container>
  );
}
