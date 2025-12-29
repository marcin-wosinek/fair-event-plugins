import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Button, Spinner, Notice } from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Team Members meta box component.
 *
 * Allows linking and unlinking team members to/from a post.
 */
export default function PostTeamMembers() {
	const [teamMembers, setTeamMembers] = useState([]);
	const [allTeamMembers, setAllTeamMembers] = useState([]);
	const [selectedId, setSelectedId] = useState('');
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);

	const postId = fairTeamMembersData.postId;

	useEffect(() => {
		loadData();
	}, []);

	const loadData = async () => {
		setLoading(true);
		setError(null);

		try {
			// Load linked team members
			const linked = await apiFetch({
				path: `/fair-team/v1/posts/${postId}/team-members`,
			});

			// Load all team members for dropdown
			const all = await apiFetch({
				path: '/wp/v2/fair_team_member?per_page=100',
			});

			setTeamMembers(linked);
			setAllTeamMembers(all);
		} catch (err) {
			setError(__('Failed to load team members.', 'fair-team'));
		} finally {
			setLoading(false);
		}
	};

	const addTeamMember = async () => {
		if (!selectedId) return;

		setSaving(true);
		setError(null);

		try {
			await apiFetch({
				path: `/fair-team/v1/posts/${postId}/team-members`,
				method: 'POST',
				data: {
					team_member_id: parseInt(selectedId, 10),
				},
			});

			setSelectedId('');
			await loadData();
		} catch (err) {
			setError(__('Failed to add team member.', 'fair-team'));
		} finally {
			setSaving(false);
		}
	};

	const removeTeamMember = async (teamMemberId) => {
		setSaving(true);
		setError(null);

		try {
			await apiFetch({
				path: `/fair-team/v1/posts/${postId}/team-members/${teamMemberId}`,
				method: 'DELETE',
			});

			await loadData();
		} catch (err) {
			setError(__('Failed to remove team member.', 'fair-team'));
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return <Spinner />;
	}

	// Filter out already added team members
	const availableTeamMembers = allTeamMembers.filter(
		(tm) => !teamMembers.find((linked) => linked.team_member_id === tm.id)
	);

	return (
		<div className="fair-team-members">
			{error && (
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			)}

			<div className="fair-team-members__list">
				{teamMembers.length === 0 && (
					<p>{__('No team members linked yet.', 'fair-team')}</p>
				)}

				{teamMembers.map((tm) => (
					<div key={tm.id} className="fair-team-members__item">
						<span>{tm.team_member_name}</span>
						<Button
							isDestructive
							isSmall
							onClick={() => removeTeamMember(tm.team_member_id)}
							disabled={saving}
						>
							{__('Remove', 'fair-team')}
						</Button>
					</div>
				))}
			</div>

			{availableTeamMembers.length > 0 && (
				<div className="fair-team-members__add">
					<select
						value={selectedId}
						onChange={(e) => setSelectedId(e.target.value)}
						disabled={saving}
					>
						<option value="">
							{__('Select team member...', 'fair-team')}
						</option>
						{availableTeamMembers.map((tm) => (
							<option key={tm.id} value={tm.id}>
								{tm.title.rendered}
							</option>
						))}
					</select>

					<Button
						isPrimary
						onClick={addTeamMember}
						disabled={!selectedId || saving}
					>
						{saving
							? __('Adding...', 'fair-team')
							: __('Add', 'fair-team')}
					</Button>
				</div>
			)}
		</div>
	);
}
