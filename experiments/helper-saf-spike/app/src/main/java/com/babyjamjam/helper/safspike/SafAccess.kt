package com.babyjamjam.helper.safspike

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.CancellationSignal
import android.provider.DocumentsContract
import java.io.InputStream

class SafAccess(context: Context) {
    private val resolver: ContentResolver = context.applicationContext.contentResolver

    fun grantStatus(treeUri: Uri?): GrantStatus {
        if (treeUri == null) return GrantStatus.NOT_SELECTED
        return try {
            val found = resolver.persistedUriPermissions.any { permission ->
                permission.uri == treeUri && permission.isReadPermission
            }
            if (found) GrantStatus.GRANTED else GrantStatus.MISSING
        } catch (_: SecurityException) {
            GrantStatus.ERROR
        } catch (_: Exception) {
            GrantStatus.ERROR
        }
    }

    fun takeReadGrant(treeUri: Uri): GrantStatus = try {
        resolver.takePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        grantStatus(treeUri)
    } catch (_: SecurityException) {
        GrantStatus.ERROR
    } catch (_: IllegalArgumentException) {
        GrantStatus.ERROR
    } catch (_: Exception) {
        GrantStatus.ERROR
    }

    fun releaseReadGrant(treeUri: Uri): ProviderStatus = try {
        resolver.releasePersistableUriPermission(treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        ProviderStatus.OK
    } catch (error: Exception) {
        normalizeProviderFailure(error)
    }

    fun listDirectChildren(treeUri: Uri, cancellationSignal: CancellationSignal? = null): ListingResult {
        return try {
            val documentId = DocumentsContract.getTreeDocumentId(treeUri)
            val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId)
            val projection = arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_SIZE,
                DocumentsContract.Document.COLUMN_LAST_MODIFIED,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
            )
            val cursor = resolver.query(childrenUri, projection, null, null, null, cancellationSignal)
                ?: return ListingResult(entries = emptyList(), status = ProviderStatus.PROVIDER_ERROR)
            try {
                readListing(cursor)
            } finally {
                cursor.close()
            }
        } catch (error: Exception) {
            ListingResult(entries = emptyList(), status = normalizeProviderFailure(error))
        }
    }

    fun readOneByte(treeUri: Uri, documentId: String): ReadProbeStatus {
        return try {
            val documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
            val stream: InputStream = resolver.openInputStream(documentUri)
                ?: return ReadProbeStatus.PROVIDER_ERROR
            stream.use { input ->
                if (input.read() < 0) ReadProbeStatus.EMPTY else ReadProbeStatus.READ_ONE_BYTE
            }
        } catch (error: Exception) {
            providerStatusToProbeStatus(normalizeProviderFailure(error))
        }
    }

    private fun readListing(cursor: Cursor): ListingResult {
        val idIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
        if (idIndex < 0) return ListingResult(entries = emptyList(), status = ProviderStatus.PROVIDER_ERROR)
        val nameIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
        val sizeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)
        val modifiedIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
        val mimeIndex = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_MIME_TYPE)
        val bounded = takeAtMostCapPlusOne(object : Iterator<DocumentMetadata?> {
            override fun hasNext(): Boolean = cursor.moveToNext()

            override fun next(): DocumentMetadata? {
                val documentId = cursor.getString(idIndex) ?: return null
                return DocumentMetadata(
                    documentId = documentId,
                    displayName = cursor.getNullableString(nameIndex),
                    size = cursor.getNullableLong(sizeIndex),
                    lastModifiedEpochMs = cursor.getNullableLong(modifiedIndex),
                    mimeType = cursor.getNullableString(mimeIndex),
                )
            }
        })
        val providerLoading = cursor.extras?.getBoolean(DocumentsContract.EXTRA_LOADING, false) == true
        return ListingResult(
            entries = bounded.rows.filterNotNull(),
            providerLoading = providerLoading,
            entryCapReached = bounded.entryCapReached,
            status = ProviderStatus.OK,
        )
    }

    private fun Cursor.getNullableString(index: Int): String? =
        if (index < 0 || isNull(index)) null else getString(index)

    private fun Cursor.getNullableLong(index: Int): Long? =
        if (index < 0 || isNull(index)) null else getLong(index)
}
