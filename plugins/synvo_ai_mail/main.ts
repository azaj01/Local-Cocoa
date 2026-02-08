import { ipcMain } from 'electron';
import {
    listEmailAccounts,
    addEmailAccount,
    removeEmailAccount,
    syncEmailAccount,
    listEmailMessages,
    getEmailMessage,
    startOutlookAuth,
    getOutlookAuthStatus,
    completeOutlookSetup,
    buildAccountMemory,
    getAccountMemoryStatus,
    getAccountMemoryDetails,
    accountQA
} from '../../src/main/backendClient';
import { EmailAccountPayload } from '../../src/main/types';

export function registerHandlers() {
    ipcMain.handle('email:list', async () => listEmailAccounts());

    ipcMain.handle('email:add', async (_event, payload: EmailAccountPayload) => {
        if (!payload?.host || !payload.username || !payload.password || !payload.label) {
            throw new Error('Incomplete email connector payload.');
        }
        return addEmailAccount(payload);
    });

    ipcMain.handle('email:outlook:auth', async (_event, payload: { clientId: string; tenantId: string }) => {
        return startOutlookAuth(payload.clientId, payload.tenantId);
    });

    ipcMain.handle('email:outlook:status', async (_event, flowId: string) => {
        return getOutlookAuthStatus(flowId);
    });

    ipcMain.handle('email:outlook:complete', async (_event, payload: { flowId: string; label: string }) => {
        return completeOutlookSetup(payload.flowId, payload.label);
    });

    ipcMain.handle('email:remove', async (_event, accountId: string) => {
        if (!accountId) {
            throw new Error('Missing email account id.');
        }
        await removeEmailAccount(accountId);
        return { id: accountId };
    });

    ipcMain.handle('email:sync', async (_event, payload: { accountId: string; limit?: number }) => {
        const accountId = payload?.accountId;
        if (!accountId) {
            throw new Error('Missing email account id.');
        }
        return syncEmailAccount(accountId, payload?.limit);
    });

    ipcMain.handle('email:messages', async (_event, payload: { accountId: string; limit?: number }) => {
        const accountId = payload?.accountId;
        if (!accountId) {
            throw new Error('Missing email account id.');
        }
        return listEmailMessages(accountId, payload?.limit);
    });

    ipcMain.handle('email:message', async (_event, payload: { messageId: string }) => {
        const messageId = payload?.messageId;
        if (!messageId) {
            throw new Error('Missing email message id.');
        }
        return getEmailMessage(messageId);
    });

    // ==================== Account-Level Memory Handlers (memory-v2.5) ====================

    ipcMain.handle('email:build-account-memory', async (_event, payload: { 
        accountId: string; 
        userId?: string; 
    }) => {
        const accountId = payload?.accountId;
        if (!accountId) {
            throw new Error('Missing email account id.');
        }
        return buildAccountMemory(accountId, payload.userId);
    });

    ipcMain.handle('email:account-memory-status', async (_event, payload: { 
        accountId: string; 
        userId?: string;
    }) => {
        const accountId = payload?.accountId;
        if (!accountId) {
            throw new Error('Missing email account id.');
        }
        return getAccountMemoryStatus(accountId, payload.userId);
    });

    ipcMain.handle('email:account-memory-details', async (_event, payload: { 
        accountId: string; 
        userId?: string;
        limit?: number;
    }) => {
        const accountId = payload?.accountId;
        if (!accountId) {
            throw new Error('Missing email account id.');
        }
        return getAccountMemoryDetails(accountId, payload.userId, payload.limit);
    });

    ipcMain.handle('email:account-qa', async (_event, payload: { 
        accountId: string; 
        question: string;
        userId?: string;
    }) => {
        const accountId = payload?.accountId;
        if (!accountId) {
            throw new Error('Missing email account id.');
        }
        if (!payload.question) {
            throw new Error('Missing question.');
        }
        return accountQA(accountId, payload.question, payload.userId);
    });
}
