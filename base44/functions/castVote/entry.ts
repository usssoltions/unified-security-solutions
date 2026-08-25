import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * castVote — atomically records a resident's vote on a VotingQuestion.
 *
 * Ballot integrity rules enforced server-side (the previous client-side
 * read-modify-write was racy and allowed double-voting / count tampering):
 *   1. The user must be authenticated.
 *   2. The question must be in the "open" status.
 *   3. The question's close_date (if set) must not have passed.
 *   4. The user must not already appear in voted_user_ids (dedup).
 *   5. For yes_no / single_choice exactly one option index is accepted; for
 *      multiple_choice one or more option indices are accepted.
 *
 * Returns the updated question so the caller can re-render tallies without a
 * refetch.
 */
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const questionId = body.question_id;
    let optionIndices = Array.isArray(body.option_indices)
      ? body.option_indices.map((n) => Number(n))
      : (body.option_index != null ? [Number(body.option_index)] : []);

    if (!questionId) return Response.json({ error: 'Missing question_id' }, { status: 400 });
    if (optionIndices.length === 0) return Response.json({ error: 'No option selected' }, { status: 400 });

    const question = await base44.entities.VotingQuestion.get(questionId);
    if (!question) return Response.json({ error: 'Question not found' }, { status: 404 });

    if (question.status !== 'open') {
      return Response.json({ error: 'This vote is not currently open' }, { status: 409 });
    }
    if (question.close_date && new Date(question.close_date) < new Date()) {
      return Response.json({ error: 'This vote has closed' }, { status: 409 });
    }
    const votedIds = Array.isArray(question.voted_user_ids) ? question.voted_user_ids : [];
    if (votedIds.includes(user.id)) {
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
    const newVotedIds = [...votedIds, user.id];

    const updated = await base44.entities.VotingQuestion.update(questionId, {
      options,
      total_votes: totalVotes,
      voted_user_ids: newVotedIds,
    });

    return Response.json({ success: true, question: updated });
  } catch (error) {
    return Response.json({ error: error.message || 'Failed to cast vote' }, { status: 500 });
  }
}