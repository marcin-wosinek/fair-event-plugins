import './editor.css';
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { Spinner } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useState, useEffect } from '@wordpress/element';

registerBlockType('fair-team/team-members-list', {
	edit: ({ context }) => {
		const blockProps = useBlockProps();
		const [teamMembers, setTeamMembers] = useState([]);
		const [loading, setLoading] = useState(true);

		// Get post ID from context or editor
		const postId =
			context.postId ||
			useSelect((select) => select('core/editor')?.getCurrentPostId());

		useEffect(() => {
			if (!postId) {
				setLoading(false);
				return;
			}

			apiFetch({
				path: `/fair-team/v1/posts/${postId}/team-members`,
			})
				.then((data) => {
					setTeamMembers(data);
					setLoading(false);
				})
				.catch(() => {
					setLoading(false);
				});
		}, [postId]);

		if (loading) {
			return (
				<div {...blockProps}>
					<Spinner />
				</div>
			);
		}

		if (!postId) {
			return (
				<div {...blockProps}>
					<p>
						{__(
							'Please save the post to see team members.',
							'fair-team'
						)}
					</p>
				</div>
			);
		}

		if (teamMembers.length === 0) {
			return (
				<div {...blockProps}>
					<p>
						{__(
							'No team members assigned to this post.',
							'fair-team'
						)}
					</p>
				</div>
			);
		}

		return (
			<div {...blockProps}>
				<h3>{__('Team Members', 'fair-team')}</h3>
				<ul>
					{teamMembers.map((member) => (
						<li key={member.id}>
							{member.team_member_name}
							{member.instagram_url && (
								<>
									{' '}
									(
									<a
										href={member.instagram_url}
										target="_blank"
										rel="noopener noreferrer"
									>
										@
										{member.instagram_handle || 'instagram'}
									</a>
									)
								</>
							)}
						</li>
					))}
				</ul>
			</div>
		);
	},
	save: () => {
		return null; // Dynamic block, rendered via PHP
	},
});
