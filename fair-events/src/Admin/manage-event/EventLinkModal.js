/**
 * EventLinkModal — "Where does this event link to?" popup.
 *
 * Owns the link-target choice (external URL, create-new-page, link-existing,
 * or none), plus the linked-posts list with view/edit/unlink. Every change
 * applies immediately via its own apiFetch call and reports back through
 * onSaved(updated) — there is no separate save step (#1198).
 *
 * @package FairEvents
 */

import { useState } from '@wordpress/element';
import {
	Button,
	Modal,
	Notice,
	RadioControl,
	SelectControl,
	TextControl,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * @param {Object}   props
 * @param {number}   props.eventDateId      The event date being edited.
 * @param {Object}   props.eventDate        Event date object from the REST API.
 * @param {Array}    props.enabledPostTypes Post types the organizer can create ({ slug, label }).
 * @param {Function} props.onClose          Called to dismiss the modal.
 * @param {Function} props.onSaved          Called with the updated event date after any successful change.
 */
export default function EventLinkModal({
	eventDateId,
	eventDate,
	enabledPostTypes,
	onClose,
	onSaved,
}) {
	const linkedPosts = eventDate.linked_posts || [];
	const isLinkedToPost =
		eventDate.link_type === 'post' && linkedPosts.length > 0;

	const [linkType, setLinkType] = useState(eventDate.link_type || 'none');
	const [externalUrl, setExternalUrl] = useState(
		eventDate.external_url || ''
	);
	const [selectedPostType, setSelectedPostType] = useState(
		enabledPostTypes[0]?.slug || 'fair_event'
	);
	const [linkPostId, setLinkPostId] = useState('');
	const [searchResults, setSearchResults] = useState([]);
	const [creatingPost, setCreatingPost] = useState(false);
	const [linkingPost, setLinkingPost] = useState(false);
	const [unlinkingPostId, setUnlinkingPostId] = useState(null);
	const [applying, setApplying] = useState(false);
	const [error, setError] = useState(null);

	const handleApplyChoice = async () => {
		setApplying(true);
		setError(null);

		try {
			const updated = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}`,
				method: 'PUT',
				data: {
					link_type: linkType,
					external_url: linkType === 'external' ? externalUrl : null,
				},
			});
			onSaved(updated);
		} catch (err) {
			setError(
				err.message || __('Failed to update the link.', 'fair-events')
			);
		} finally {
			setApplying(false);
		}
	};

	const handleCreatePost = async () => {
		setCreatingPost(true);
		setError(null);

		try {
			const result = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/create-post`,
				method: 'POST',
				data: {
					post_type: selectedPostType,
					post_status: 'draft',
				},
			});

			if (result.edit_url) {
				window.location.href = result.edit_url;
			}
		} catch (err) {
			setError(
				err.message || __('Failed to create post.', 'fair-events')
			);
		} finally {
			setCreatingPost(false);
		}
	};

	const handleSearchPosts = async (searchTerm) => {
		if (!searchTerm || searchTerm.length < 2) {
			setSearchResults([]);
			return;
		}

		try {
			const results = await apiFetch({
				path: `/wp/v2/search?search=${encodeURIComponent(
					searchTerm
				)}&type=post&subtype=any&per_page=10`,
			});
			setSearchResults(results);
		} catch {
			// Ignore search errors.
		}
	};

	const handleLinkPost = async () => {
		if (!linkPostId) return;
		setLinkingPost(true);
		setError(null);

		try {
			const updated = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/link-post`,
				method: 'POST',
				data: {
					post_id: parseInt(linkPostId, 10),
				},
			});
			setLinkPostId('');
			setSearchResults([]);
			onSaved(updated);
		} catch (err) {
			setError(err.message || __('Failed to link post.', 'fair-events'));
		} finally {
			setLinkingPost(false);
		}
	};

	const handleUnlinkPost = async (postId) => {
		setUnlinkingPostId(postId);
		setError(null);

		try {
			const updated = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/link-post`,
				method: 'DELETE',
				data: {
					post_id: postId,
				},
			});
			onSaved(updated);
		} catch (err) {
			setError(
				err.message || __('Failed to unlink post.', 'fair-events')
			);
		} finally {
			setUnlinkingPostId(null);
		}
	};

	return (
		<Modal
			title={__('Where does this event link to?', 'fair-events')}
			onRequestClose={onClose}
			className="fair-events-event-link-modal"
		>
			<VStack spacing={4}>
				{error && (
					<Notice status="error" isDismissible={false}>
						{error}
					</Notice>
				)}

				{linkedPosts.length > 0 && (
					<>
						<Notice status="info" isDismissible={false}>
							{sprintf(
								/* translators: %d: number of linked posts */
								_n(
									'This event is linked to %d post.',
									'This event is linked to %d posts.',
									linkedPosts.length,
									'fair-events'
								),
								linkedPosts.length
							)}
						</Notice>
						{linkedPosts.map((lp) => (
							<HStack key={lp.id} spacing={3} wrap>
								<span>
									<strong>{lp.title}</strong> ({lp.status})
									{lp.is_primary && (
										<span
											style={{
												marginLeft: '4px',
												color: '#007cba',
												fontSize: '12px',
											}}
										>
											{__('Primary', 'fair-events')}
										</span>
									)}
								</span>
								{lp.view_url && (
									<Button
										variant="secondary"
										href={lp.view_url}
										target="_blank"
										size="small"
									>
										{__('View Entry', 'fair-events')}
									</Button>
								)}
								{lp.edit_url && (
									<Button
										variant="secondary"
										href={lp.edit_url}
										size="small"
									>
										{__('Edit Post', 'fair-events')}
									</Button>
								)}
								<Button
									variant="tertiary"
									size="small"
									isDestructive
									isBusy={unlinkingPostId === lp.id}
									disabled={unlinkingPostId === lp.id}
									onClick={() => handleUnlinkPost(lp.id)}
								>
									{__('Unlink', 'fair-events')}
								</Button>
							</HStack>
						))}
					</>
				)}

				{!isLinkedToPost && linkedPosts.length === 0 && (
					<>
						<RadioControl
							label={__('Link type', 'fair-events')}
							hideLabelFromVision
							selected={linkType}
							options={[
								{
									label: __(
										'A page on this site',
										'fair-events'
									),
									value: 'post',
								},
								{
									label: __(
										'An external website',
										'fair-events'
									),
									value: 'external',
								},
								{
									label: __(
										'Nowhere — show details only',
										'fair-events'
									),
									value: 'none',
								},
							]}
							onChange={setLinkType}
						/>

						{linkType === 'external' && (
							<>
								<TextControl
									label={__('External URL', 'fair-events')}
									type="url"
									value={externalUrl}
									onChange={setExternalUrl}
									placeholder="https://"
								/>
								<HStack justify="flex-end">
									<Button
										variant="primary"
										onClick={handleApplyChoice}
										isBusy={applying}
										disabled={applying || !externalUrl}
									>
										{__('Set external link', 'fair-events')}
									</Button>
								</HStack>
							</>
						)}

						{linkType === 'none' && (
							<HStack justify="flex-end">
								<Button
									variant="primary"
									onClick={handleApplyChoice}
									isBusy={applying}
									disabled={applying}
								>
									{__('Confirm', 'fair-events')}
								</Button>
							</HStack>
						)}

						{linkType === 'post' && (
							<>
								<SelectControl
									label={__('Post type', 'fair-events')}
									value={selectedPostType}
									options={enabledPostTypes.map((pt) => ({
										label: pt.label,
										value: pt.slug,
									}))}
									onChange={setSelectedPostType}
								/>
								<Button
									variant="primary"
									onClick={handleCreatePost}
									isBusy={creatingPost}
									disabled={creatingPost}
								>
									{__('Create New Post', 'fair-events')}
								</Button>

								<VStack spacing={2}>
									<h3 style={{ margin: 0 }}>
										{__(
											'Link Existing Post',
											'fair-events'
										)}
									</h3>
									<TextControl
										label={__(
											'Search posts by title',
											'fair-events'
										)}
										onChange={handleSearchPosts}
										placeholder={__(
											'Start typing to search...',
											'fair-events'
										)}
									/>
									{searchResults.length > 0 && (
										<SelectControl
											label={__(
												'Select a post',
												'fair-events'
											)}
											value={linkPostId}
											options={[
												{
													label: __(
														'Select...',
														'fair-events'
													),
													value: '',
												},
												...searchResults.map((r) => ({
													label: r.title,
													value: String(r.id),
												})),
											]}
											onChange={setLinkPostId}
										/>
									)}
									{linkPostId && (
										<Button
											variant="primary"
											onClick={handleLinkPost}
											isBusy={linkingPost}
											disabled={linkingPost}
										>
											{__('Link Post', 'fair-events')}
										</Button>
									)}
								</VStack>
							</>
						)}
					</>
				)}

				<HStack justify="flex-end" spacing={2}>
					<Button variant="tertiary" onClick={onClose}>
						{__('Close', 'fair-events')}
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}
