package com.imirae.incheon.ui.contracts

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.imirae.incheon.design.DesignTokens
import com.imirae.incheon.domain.models.CreateContractRequest
import com.imirae.incheon.ui.components.AppTextField
import com.imirae.incheon.viewmodel.ContractListViewModel

@Composable
fun ContractCreationScreen(
    viewModel: ContractListViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    var clientId by remember { mutableStateOf("") }
    var employeeId by remember { mutableStateOf("") }
    var startDate by remember { mutableStateOf("") }
    var endDate by remember { mutableStateOf("") }
    var serviceType by remember { mutableStateOf("") }
    var amount by remember { mutableStateOf("") }
    var clientIdError by remember { mutableStateOf<String?>(null) }
    var startDateError by remember { mutableStateOf<String?>(null) }
    var endDateError by remember { mutableStateOf<String?>(null) }
    var serviceTypeError by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(uiState.createSuccess) { if (uiState.createSuccess) onNavigateBack() }

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(DesignTokens.Spacing.lg.dp).testTag("contract-creation-screen"),
        verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onNavigateBack, modifier = Modifier.testTag("contract-creation-back")) { Icon(Icons.Default.ArrowBack, "뒤로") }
            Text("계약 생성", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, modifier = Modifier.testTag("contract-creation-title"))
        }

        Card(shape = RoundedCornerShape(DesignTokens.Radius.lg), elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)) {
            Column(modifier = Modifier.padding(DesignTokens.Spacing.lg.dp), verticalArrangement = Arrangement.spacedBy(DesignTokens.Spacing.md.dp)) {
                AppTextField(value = clientId, onValueChange = { clientId = it; clientIdError = null }, label = "고객 ID *", error = clientIdError, testTag = "contract-creation-client-id")
                AppTextField(value = employeeId, onValueChange = { employeeId = it }, label = "직원 ID", testTag = "contract-creation-employee-id")
                AppTextField(value = startDate, onValueChange = { startDate = it; startDateError = null }, label = "시작일 (YYYY-MM-DD) *", error = startDateError, testTag = "contract-creation-start-date")
                AppTextField(value = endDate, onValueChange = { endDate = it; endDateError = null }, label = "종료일 (YYYY-MM-DD) *", error = endDateError, testTag = "contract-creation-end-date")
                AppTextField(value = serviceType, onValueChange = { serviceType = it; serviceTypeError = null }, label = "서비스 유형 *", error = serviceTypeError, testTag = "contract-creation-service-type")
                AppTextField(value = amount, onValueChange = { amount = it }, label = "금액", testTag = "contract-creation-amount")
            }
        }

        Button(
            onClick = {
                clientIdError = if (clientId.isBlank()) "고객 ID를 입력해 주세요" else null
                startDateError = if (startDate.isBlank()) "시작일을 입력해 주세요" else null
                endDateError = if (endDate.isBlank()) "종료일을 입력해 주세요" else null
                serviceTypeError = if (serviceType.isBlank()) "서비스 유형을 입력해 주세요" else null
                if (clientIdError == null && startDateError == null && endDateError == null && serviceTypeError == null) {
                    viewModel.createContract(CreateContractRequest(clientId = clientId, employeeId = employeeId.ifBlank { null }, startDate = startDate, endDate = endDate, serviceType = serviceType, amount = amount.toLongOrNull()))
                }
            },
            enabled = !uiState.isCreating,
            modifier = Modifier.fillMaxWidth().height(48.dp).testTag("contract-creation-submit"),
            shape = RoundedCornerShape(DesignTokens.Radius.md)
        ) {
            if (uiState.isCreating) CircularProgressIndicator(modifier = Modifier.size(20.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
            else Text("계약 생성", fontWeight = FontWeight.SemiBold)
        }
    }
}
