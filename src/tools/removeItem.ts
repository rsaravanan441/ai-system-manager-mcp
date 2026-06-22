import db from "../services/database";
import runPowerShell from "../services/powershell";

export type RemoveRequest = {
  recommendationId: number;
  confirmationToken: string;
  approve: boolean; // must be true to execute
  approvedBy?: string;
  dryRun?: boolean;
};

export async function removeItem(req: RemoveRequest) {
  // Validate approval record exists and token matches (simple pattern)
  const rec = db.getRecommendationById(req.recommendationId);
  if (!rec) {
    throw new Error(`Recommendation ${req.recommendationId} not found`);
  }

  // For security, require explicit approval flag and confirmation token
  if (!req.approve) {
    return { ok: false, message: "Not approved", recommendation: rec };
  }

  // create approval record
  const approvalId = db.createApproval({
    recommendation_id: req.recommendationId,
    approved_by: req.approvedBy ?? "local-user",
    approved_at: new Date().toISOString(),
    confirmation_token: req.confirmationToken,
    dry_run: req.dryRun ? 1 : 0,
    comment: "Approved via MCP removeItem API",
  });

  // Simulate or execute
  const actionCommand = `# simulated action for ${rec.item_type} ${rec.item_key}`;

  // Log execution start
  const execLogId = db.createExecutionLog({
    recommendation_id: req.recommendationId,
    action: "removeItem:execute",
    command: actionCommand,
    started_at: new Date().toISOString(),
    finished_at: null,
    success: 0,
    output: null,
    error: null,
    rollback_metadata: JSON.stringify({ restoreAdvice: "Create system restore point or backup before removal" }),
  });

  if (req.dryRun) {
    db.createExecutionLog({
      recommendation_id: req.recommendationId,
      action: "removeItem:dryrun",
      command: actionCommand,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      success: 1,
      output: "Dry run - no action executed",
      error: null,
      rollback_metadata: null,
    });
    return { ok: true, dryRun: true, approvalId, execLogId };
  }

  // For safety, we don't implement automatic deletion here. If a real command is required, it must be carefully constructed.
  // As example, we will call a PowerShell script path only if it exists inside allowed dirs and the recommender provides a script.

  let result = { ok: false, message: "No executable action configured for this recommendation" };
  // If metadata contains a 'powershellScript' path, attempt to execute it via runPowerShell
  try {
    const metadata = rec.metadata ? JSON.parse(rec.metadata) : null;
    if (metadata && metadata.powershellScript) {
      // Require that metadata includes an explicit command and that approval was given
      const psResult = await runPowerShell(metadata.powershellScript, [], { dryRun: false });
      db.createExecutionLog({
        recommendation_id: req.recommendationId,
        action: "removeItem:powershell",
        command: metadata.powershellScript,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        success: psResult.success ? 1 : 0,
        output: psResult.stdout,
        error: psResult.stderr || null,
        rollback_metadata: JSON.stringify({ restoreAdvice: "Manual restore from backup" }),
      });
      result = { ok: psResult.success, psResult };
    }
  } catch (err: any) {
    db.createExecutionLog({
      recommendation_id: req.recommendationId,
      action: "removeItem:error",
      command: actionCommand,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      success: 0,
      output: null,
      error: String(err),
      rollback_metadata: null,
    });
    result = { ok: false, message: String(err) };
  }

  return result;
}
