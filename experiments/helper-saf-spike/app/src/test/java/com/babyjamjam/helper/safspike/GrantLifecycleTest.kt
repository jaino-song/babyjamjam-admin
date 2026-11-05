package com.babyjamjam.helper.safspike

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GrantLifecycleTest {
    @Test
    fun replacingThenRevokingOnlyReleasesDiagnosticSelection() {
        val backend = FakeGrantBackend()
        val coordinator = GrantLifecycleCoordinator(backend)

        assertEquals(GrantLifecycleOutcome.ACQUIRED, coordinator.select("tree-A").outcome)
        assertEquals(GrantLifecycleOutcome.REPLACED, coordinator.select("tree-B").outcome)
        assertEquals(GrantLifecycleOutcome.ALREADY_REVOKED, coordinator.revoke().outcome)

        assertFalse(backend.grants.contains("tree-A"))
        assertFalse(backend.grants.contains("tree-B"))
        assertEquals(null, coordinator.activeUri())
        assertEquals(listOf("take:tree-A", "release:tree-A", "take:tree-B", "release:tree-B"), backend.actions)
    }

    @Test
    fun failedReplacementReleaseKeepsOldGrantAndAllowsRetry() {
        val backend = FakeGrantBackend()
        val coordinator = GrantLifecycleCoordinator(backend)
        coordinator.select("tree-A")
        backend.releaseStatus = ProviderStatus.PROVIDER_ERROR

        val failed = coordinator.select("tree-B")

        assertEquals(GrantLifecycleOutcome.RELEASE_FAILED, failed.outcome)
        assertEquals("tree-A", failed.activeUri)
        assertEquals(GrantStatus.GRANTED, failed.grantStatus)
        assertEquals(setOf("tree-A"), backend.grants)
        assertFalse(backend.actions.contains("take:tree-B"))

        backend.releaseStatus = ProviderStatus.OK
        val retried = coordinator.select("tree-B")

        assertEquals(GrantLifecycleOutcome.REPLACED, retried.outcome)
        assertEquals("tree-B", coordinator.activeUri())
        assertEquals(setOf("tree-B"), backend.grants)
        assertTrue(backend.actions.contains("take:tree-B"))
    }

    @Test
    fun failedRevokeKeepsSelectionForRetry() {
        val backend = FakeGrantBackend()
        val coordinator = GrantLifecycleCoordinator(backend)
        coordinator.select("tree-A")
        backend.releaseStatus = ProviderStatus.PROVIDER_ERROR

        val failed = coordinator.revoke()

        assertEquals(GrantLifecycleOutcome.RELEASE_FAILED, failed.outcome)
        assertEquals("tree-A", coordinator.activeUri())
        assertEquals(setOf("tree-A"), backend.grants)

        backend.releaseStatus = ProviderStatus.OK
        assertEquals(GrantLifecycleOutcome.ALREADY_REVOKED, coordinator.revoke().outcome)
        assertEquals(null, coordinator.activeUri())
    }

    private class FakeGrantBackend : GrantLifecycleBackend {
        val grants = linkedSetOf<String>()
        val actions = mutableListOf<String>()
        var releaseStatus = ProviderStatus.OK

        override fun grantStatus(uri: String): GrantStatus =
            if (grants.contains(uri)) GrantStatus.GRANTED else GrantStatus.MISSING

        override fun takeReadGrant(uri: String): GrantStatus {
            actions += "take:$uri"
            grants += uri
            return GrantStatus.GRANTED
        }

        override fun releaseReadGrant(uri: String): ProviderStatus {
            actions += "release:$uri"
            if (releaseStatus == ProviderStatus.OK) grants -= uri
            return releaseStatus
        }
    }
}
