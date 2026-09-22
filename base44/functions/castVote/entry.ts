import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { resolveTenantCaller } from '../../shared/tenantCaller.ts';

/**
 * castVote — atomically records a resident's vote on a VotingQuestion.
 *
 * Ballot integrity + tenant isolation, ALL enforced server-side:
 *   1. The user must be authenticated (authoritative User record wins over
 *      possibly-stale session claims via resolveTenantCaller).
 *   2. The user must belong to the question's tenant (or be a platform
 *      admin) — a resident of Estate A can never vote in Estate B's poll.
 *   3. The question must be in the "open" status and its close_date, if
 *      set, must not have passed.
 *   4. The user must not already appear in voted_user_ids (dedup).
 *   5. For yes_no / single_choice exactly one option index is accepted;
 *      for multiple_choice one or more option indices are accepted.
 *
 * Reads/writes use the SERVICE ROLE (tenant scope is verified in code, not
 * via session-token RLS templates which do not reliably carry custom User
 * fields). Returns the updated question so the caller can re-render tallies.
 */
export default async function main(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await resolveTenantCaller(base44);
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const questionId = body.question_id;
    const optionIndices = Array.isArray(body.option_indices)
      ? body.option_indices.map((n) => Number(n))
      : (body.option_index != null ? [Number(body.option_index)] : []);

    if (!questionId) return Response.json({ error: 'Missing question_id' }, { status: 400 });
    if (optionIndices.length === 0) return Response.json({ error: 'No option selected' }, { status: 400 });

    const svc = base44.asServiceRole;
    const rows = await svc.entities.VotingQuestion.filter({ id: String(questionId) }).catch(() => []);
    const question = (rows && rows[0]) || null;
    if (!question) return Response.json({ error: 'Question not found' }, { status: 404 });

    // Tenant isolation: only members of the question's customer may vote.
    const isPlatform = caller.role === 'admin' || caller.role_type === 'platform_admin' || caller.admin_level === 'platform';
    if (!isPlatform) {
      const callerCustomer = caller.customer_id || null;
      if (!callerCustomer || !question.customer_id || question.customer_id !== callerCustomer) {
        return Response.json({ error: 'This vote is not available for your account' }, { status: 403 });
      }
    }

    if (question.status !== 'open') {
      return Response.json({ error: 'This vote is not currently open' }, { status: 409 });
    }
    if (question.close_date && new Date(question.close_date) < new Date()) {
      return Response.json({ error: 'This vote has closed' }, { status: 409 });
    }
    const votedIds = Array.isArray(question.voted_user_ids) ? question.voted_user_ids : [];
    if (votedIds.includes(caller.id)) {
      return Response.json({ error: 'You have already voted on this question' }, { status: 409 });
    }

    const isMultiple = question.question_type === 'multiple_choice';
    if (!isMultiple && optionIndices.length > 1) {
      return Response.json({ error: 'This question accepts only one selection' }, { status: 400 });
    }

    const options = Array.isArray(question.options) ? question.options.map((o) => ({ ...o })) : [];
    const invalid = optionIndices.find((i) => i < 0 || i >= options.length || Number.isNaN(i));
    if (invalid != null) return Response.json({ error: 'Invalid option' }, { status: 400 });

    const added = new Set(optionIndices);
    for (const i of added) {
      options[i].votes = (options[i].votes || 0) + 1;
    }
    const totalVotes = (question.total_votes || 0) + added.size;
    const newVotedIds = [...votedIds, caller.id];

    const updated = await svc.entities.VotingQuestion.update(question.id, {
      options,
      total_votes: totalVotes,
      voted_user_ids: newVotedIds,
    });

    return Response.json({ success: true, question: updated });
  } catch (error) {
    return Response.json({ error: error.message || 'Failed to cast vote' }, { status: 500 });
  }
}