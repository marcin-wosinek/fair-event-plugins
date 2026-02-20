/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	TextControl,
	TextareaControl,
	Notice,
	Spinner,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	loadInstagramPosts,
	createInstagramPost,
	deleteInstagramPost,
} from './instagram-posts-api.js';

/**
 * Status badge component
 *
 * @param {Object} props Props
 * @param {string} props.status Post status
 * @return {JSX.Element} Status badge
 */
function StatusBadge({ status }) {
	const styles = {
		pending: {
			backgroundColor: '#ddd',
			color: '#333',
		},
		publishing: {
			backgroundColor: '#007cba',
			color: '#fff',
		},
		published: {
			backgroundColor: '#00a32a',
			color: '#fff',
		},
		failed: {
			backgroundColor: '#d63638',
			color: '#fff',
		},
	};

	const labels = {
		pending: __('Pending', 'fair-audience'),
		publishing: __('Publishing', 'fair-audience'),
		published: __('Published', 'fair-audience'),
		failed: __('Failed', 'fair-audience'),
	};

	return (
		<span
			style={{
				display: 'inline-block',
				padding: '2px 8px',
				borderRadius: '3px',
				fontSize: '12px',
				fontWeight: '500',
				...styles[status],
			}}
		>
			{labels[status] || status}
		</span>
	);
}

/**
 * Instagram Posts page component
 *
 * @return {JSX.Element} The Instagram posts page
 */
export default function InstagramPosts() {
	const [posts, setPosts] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isPosting, setIsPosting] = useState(false);
	const [notice, setNotice] = useState(null);

	// Form state.
	const [imageUrl, setImageUrl] = useState('');
	const [caption, setCaption] = useState('');

	/**
	 * Load posts from API
	 */
	const loadPosts = () => {
		setIsLoading(true);
		loadInstagramPosts()
			.then((data) => {
				setPosts(data);
				setIsLoading(false);
			})
			.catch((error) => {
				console.error('[Fair Audience] Failed to load posts:', error);
				setNotice({
					status: 'error',
					message:
						error.message ||
						__('Failed to load posts.', 'fair-audience'),
				});
				setIsLoading(false);
			});
	};

	/**
	 * Load posts on mount
	 */
	useEffect(() => {
		loadPosts();
	}, []);

	/**
	 * Handle form submission
	 *
	 * @param {Event} e Form event
	 */
	const handleSubmit = (e) => {
		e.preventDefault();

		if (!imageUrl.trim()) {
			setNotice({
				status: 'error',
				message: __('Please enter an image URL.', 'fair-audience'),
			});
			return;
		}

		if (!caption.trim()) {
			setNotice({
				status: 'error',
				message: __('Please enter a caption.', 'fair-audience'),
			});
			return;
		}

		setIsPosting(true);
		setNotice(null);

		createInstagramPost({
			image_url: imageUrl.trim(),
			caption: caption.trim(),
		})
			.then((result) => {
				setNotice({
					status: 'success',
					message:
						result.message ||
						__('Post published successfully!', 'fair-audience'),
				});
				setImageUrl('');
				setCaption('');
				loadPosts();
				setIsPosting(false);
			})
			.catch((error) => {
				console.error('[Fair Audience] Failed to create post:', error);
				setNotice({
					status: 'error',
					message:
						error.message ||
						__('Failed to publish post.', 'fair-audience'),
				});
				loadPosts();
				setIsPosting(false);
			});
	};

	/**
	 * Handle post duplication - copies data back into the form
	 *
	 * @param {Object} post Post object
	 */
	const handleDuplicate = (post) => {
		setImageUrl(post.image_url || '');
		setCaption(post.caption || '');
		window.scrollTo({ top: 0, behavior: 'smooth' });
	};

	/**
	 * Handle post deletion
	 *
	 * @param {number} id Post ID
	 */
	const handleDelete = (id) => {
		if (
			!confirm(
				__(
					'Are you sure you want to delete this post?',
					'fair-audience'
				)
			)
		) {
			return;
		}

		deleteInstagramPost(id)
			.then(() => {
				setNotice({
					status: 'success',
					message: __('Post deleted.', 'fair-audience'),
				});
				loadPosts();
			})
			.catch((error) => {
				console.error('[Fair Audience] Failed to delete post:', error);
				setNotice({
					status: 'error',
					message:
						error.message ||
						__('Failed to delete post.', 'fair-audience'),
				});
			});
	};

	/**
	 * Format date for display
	 *
	 * @param {string} dateString Date string
	 * @return {string} Formatted date
	 */
	const formatDate = (dateString) => {
		if (!dateString) {
			return '-';
		}
		return new Date(dateString).toLocaleString();
	};

	/**
	 * Truncate text
	 *
	 * @param {string} text Text to truncate
	 * @param {number} maxLength Maximum length
	 * @return {string} Truncated text
	 */
	const truncate = (text, maxLength = 50) => {
		if (!text || text.length <= maxLength) {
			return text;
		}
		return text.substring(0, maxLength) + '...';
	};

	return (
		<div className="wrap">
			<h1>{__('Instagram Posts', 'fair-audience')}</h1>

			{notice && (
				<Notice
					status={notice.status}
					isDismissible
					onDismiss={() => setNotice(null)}
					style={{ marginBottom: '1rem' }}
				>
					{notice.message}
				</Notice>
			)}

			{/* Create Post Form */}
			<Card style={{ marginBottom: '2rem' }}>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Create New Post', 'fair-audience')}
					</h2>
				</CardHeader>
				<CardBody>
					<form onSubmit={handleSubmit}>
						<TextControl
							label={__('Image URL', 'fair-audience')}
							value={imageUrl}
							onChange={setImageUrl}
							placeholder="https://example.com/image.jpg"
							help={__(
								'Must be a publicly accessible URL.',
								'fair-audience'
							)}
							disabled={isPosting}
						/>

						<TextareaControl
							label={__('Caption', 'fair-audience')}
							value={caption}
							onChange={setCaption}
							placeholder={__(
								'Write your caption here...',
								'fair-audience'
							)}
							rows={4}
							disabled={isPosting}
						/>

						<Button
							variant="primary"
							type="submit"
							disabled={isPosting}
							isBusy={isPosting}
						>
							{isPosting
								? __('Posting...', 'fair-audience')
								: __('Post to Instagram', 'fair-audience')}
						</Button>
					</form>
				</CardBody>
			</Card>

			{/* Posts List */}
			<Card>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Post History', 'fair-audience')}
					</h2>
				</CardHeader>
				<CardBody>
					{isLoading ? (
						<div
							style={{
								display: 'flex',
								justifyContent: 'center',
								padding: '2rem',
							}}
						>
							<Spinner />
						</div>
					) : posts.length === 0 ? (
						<p style={{ color: '#666' }}>
							{__(
								'No posts yet. Create your first post above!',
								'fair-audience'
							)}
						</p>
					) : (
						<table
							className="wp-list-table widefat fixed striped"
							style={{ marginTop: 0 }}
						>
							<thead>
								<tr>
									<th style={{ width: '40%' }}>
										{__('Caption', 'fair-audience')}
									</th>
									<th style={{ width: '15%' }}>
										{__('Status', 'fair-audience')}
									</th>
									<th style={{ width: '20%' }}>
										{__('Created', 'fair-audience')}
									</th>
									<th style={{ width: '15%' }}>
										{__('Actions', 'fair-audience')}
									</th>
								</tr>
							</thead>
							<tbody>
								{posts.map((post) => (
									<tr key={post.id}>
										<td>
											{post.permalink ? (
												<a
													href={post.permalink}
													target="_blank"
													rel="noopener noreferrer"
													title={post.caption}
												>
													{truncate(post.caption, 60)}
												</a>
											) : (
												<span
													title={post.caption}
													style={{
														cursor: 'default',
													}}
												>
													{truncate(post.caption, 60)}
												</span>
											)}
											{post.error_message && (
												<div
													style={{
														color: '#d63638',
														fontSize: '12px',
														marginTop: '4px',
													}}
												>
													{post.error_message}
												</div>
											)}
										</td>
										<td>
											<StatusBadge status={post.status} />
										</td>
										<td>{formatDate(post.created_at)}</td>
										<td>
											<Button
												isSmall
												onClick={() =>
													handleDuplicate(post)
												}
												style={{
													marginRight: '8px',
												}}
											>
												{__(
													'Duplicate',
													'fair-audience'
												)}
											</Button>
											<Button
												isDestructive
												isSmall
												onClick={() =>
													handleDelete(post.id)
												}
											>
												{__('Delete', 'fair-audience')}
											</Button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</CardBody>
			</Card>
		</div>
	);
}
