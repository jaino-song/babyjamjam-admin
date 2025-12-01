"use client";

import { useState, useEffect } from "react";
import {
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Chip,
  CircularProgress,
  Alert,
  Button,
} from "@mui/material";
import { Refresh as RefreshIcon } from "@mui/icons-material";
import { useEformsignDocuments } from "@/app/hooks";
import { eformsignApi } from "@/services/api";
import { EformsignDocument } from "@/app/lib/eformsign/types";

export function DocumentsList() {
  const [accessToken, setAccessToken] = useState<string>("");
  const [isLoadingToken, setIsLoadingToken] = useState(true);

  const { data, isLoading, error, refetch } = useEformsignDocuments(accessToken);
  console.log("data", data);

  useEffect(() => {
    const fetchToken = async () => {
      try {
        setIsLoadingToken(true);
        const executionTime = Date.now();
        const tokenResponse = await eformsignApi.getAccessToken(executionTime);
        setAccessToken(tokenResponse.oauth_token.access_token);
        console.log("tokenResponse", tokenResponse);
      } catch (err) {
        console.error("Failed to fetch access token:", err);
      } finally {
        setIsLoadingToken(false);
      }
    };

    fetchToken();
  }, []);

  const getStatusColor = (status: string, statusName: string): "success" | "warning" | "info" | "default" => {
    const lowerStatusName = statusName.toLowerCase();
    if (lowerStatusName.includes("완료") || lowerStatusName.includes("complete")) {
      return "success";
    }
    if (lowerStatusName.includes("대기") || lowerStatusName.includes("pending") || lowerStatusName.includes("진행")) {
      return "warning";
    }
    return "info";
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isLoadingToken || isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3}>
        <Alert severity="error">
          Failed to load documents: {error instanceof Error ? error.message : "Unknown error"}
        </Alert>
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1">
          Eformsign Documents
        </Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => refetch()}
        >
          Refresh
        </Button>
      </Box>

      {data && data.documents && data.documents.length > 0 ? (
        <>
          <Typography variant="body2" color="text.secondary" mb={2}>
            Total: {data.total_count} documents
          </Typography>
          <TableContainer component={Paper}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Document Title</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Workflow</TableCell>
                  <TableCell>Template</TableCell>
                  <TableCell>Created Date</TableCell>
                  <TableCell>Updated Date</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.documents.map((doc: EformsignDocument) => (
                  <TableRow key={doc.doc_id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight="medium">
                        {doc.doc_title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ID: {doc.doc_id}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={doc.doc_status_name}
                        color={getStatusColor(doc.doc_status, doc.doc_status_name)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{doc.workflow_name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Step {doc.workflow_seq}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{doc.template_name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        v{doc.template_version}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ whiteSpace: "nowrap" }}>
                        {formatDate(doc.created_date)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ whiteSpace: "nowrap" }}>
                        {formatDate(doc.updated_date)}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      ) : (
        <Alert severity="info">No documents found</Alert>
      )}
    </Box>
  );
}
