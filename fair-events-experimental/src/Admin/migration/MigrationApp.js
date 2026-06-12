/**
 * Migration App Component
 *
 * @package FairEvents
 */

import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { Button, SelectControl, Notice, Spinner } from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

export default function MigrationApp() {
	const [posts, setPosts] = useState([]);
	const [postTypes, setPostTypes] = useState([]);
	const [categories, setCategories] = useState([]);
	const [selectedPostType, setSelectedPostType] = useState('');
	const [selectedCategory, setSelectedCategory] = useState('');
	const [isLoading, setIsLoading] = useState(true);
	const [isMigrating, setIsMigrating] = useState(null);
	const [notice, setNotice] = useState(null);

	// Load initial data on mount
	useEffect(() => {
		loadPostTypes();
		loadPosts();
	}, []);

	// Reload posts when filters change
	useEffect(() => {
		if (!isLoading) {
			loadPosts();
		}
	}, [selectedPostType, selectedCategory]);

	// Load categories when post type changes
	useEffect(() => {
		if (selectedPostType) {
			loadCategories(selectedPostType);
		} else {
			setCategories([
				{ value: '', label: __('All Categories', 'fair-events') },
			]);
			setSelectedCategory('');
		}
	}, [selectedPostType]);

	/**
	 * Load available post types
	 */
	const loadPostTypes = async () => {
		try {
			const types = await apiFetch({
				path: '/fair-events/v1/migration/post-types',
			});

			setPostTypes([
				{ value: '', label: __('All Post Types', 'fair-events') },
				...types,
			]);
		} catch (error) {
			console.error('Failed to load post types:', error);
			setNotice({
				status: 'error',
				message:
					error.message ||
					__('Failed to load post types.', 'fair-events'),
			});
		}
	};

	/**
	 * Load categories for filtering
	 */
	const loadCategories = async (postType) => {
		try {
			const cats = await apiFetch({
				path: `/fair-events/v1/migration/categories?post_type=${postType}`,
			});

			setCategories(cats);
		} catch (error) {
			console.error('Failed to load categories:', error);
		}
	};

	/**
	 * Load posts with current filters
	 */
	const loadPosts = async () => {
		setIsLoading(true);
		setNotice(null);

		try {
			let path = '/fair-events/v1/migration/posts?per_page=20';
			if (selectedPostType) {
				path += `&post_type=${selectedPostType}`;
			}
			if (selectedCategory) {
				path += `&category=${selectedCategory}`;
			}

			const response = await apiFetch({ path });
			setPosts(response.posts || []);
		} catch (error) {
			console.error('Failed to load posts:', error);
			setNotice({
				status: 'error',
				message:
					error.message || __('Failed to load posts.', 'fair-events'),
			});
		} finally {
			setIsLoading(false);
		}
	};

	/**
	 * Handle post type filter change
	 */
	const handlePostTypeChange = (value) => {
		setSelectedPostType(value);
		setSelectedCategory(''); // Reset category when post type changes
	};

	/**
	 * Migrate a single post
	 */
	const handleMigrate = async (postId) => {
		setIsMigrating(postId);
		setNotice(null);

		try {
			const response = await apiFetch({
				path: '/fair-events/v1/migration/migrate',
				method: 'POST',
				data: { post_id: postId },
			});

			// Show success notice
			setNotice({
				status: 'success',
				message:
					response.message ||
					__('Post migrated successfully!', 'fair-events'),
			});

			// Remove migrated post from list
			setPosts(posts.filter((post) => post.id !== postId));
		} catch (error) {
			console.error('Migration failed:', error);
			setNotice({
				status: 'error',
				message:
					error.message ||
					__('Failed to migrate post.', 'fair-events'),
			});
		} finally {
			setIsMigrating(null);
		}
	};

	return (
		<div className="wrap">
			<h1>{__('Migrate Posts to Events', 'fair-events')}</h1>

			{notice && (
				<Notice
					status={notice.status}
					isDismissible={true}
					onRemove={() => setNotice(null)}
				>
					{notice.message}
				</Notice>
			)}

			<div
				className="fair-events-migration-filters"
				style={{ marginBottom: '20px' }}
			>
				<div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
					<div style={{ minWidth: '200px' }}>
						<SelectControl
							label={__('Post Type', 'fair-events')}
							value={selectedPostType}
							options={postTypes}
							onChange={handlePostTypeChange}
						/>
					</div>

					{selectedPostType && (
						<div style={{ minWidth: '200px' }}>
							<SelectControl
								label={__('Category', 'fair-events')}
								value={selectedCategory}
								options={categories}
								onChange={setSelectedCategory}
							/>
						</div>
					)}
				</div>
			</div>

			{isLoading ? (
				<div style={{ textAlign: 'center', padding: '40px' }}>
					<Spinner />
				</div>
			) : posts.length === 0 ? (
				<p>
					{__(
						'No posts found. Try changing the filters or create some posts first.',
						'fair-events'
					)}
				</p>
			) : (
				<table className="wp-list-table widefat fixed striped">
					<thead>
						<tr>
							<th style={{ width: '40%' }}>
								{__('Title', 'fair-events')}
							</th>
							<th style={{ width: '15%' }}>
								{__('Type', 'fair-events')}
							</th>
							<th style={{ width: '15%' }}>
								{__('Author', 'fair-events')}
							</th>
							<th style={{ width: '15%' }}>
								{__('Date', 'fair-events')}
							</th>
							<th style={{ width: '15%' }}>
								{__('Actions', 'fair-events')}
							</th>
						</tr>
					</thead>
					<tbody>
						{posts.map((post) => (
							<tr key={post.id}>
								<td>
									<strong>
										<a
											href={post.edit_link}
											target="_blank"
											rel="noopener noreferrer"
										>
											{post.title ||
												__('(no title)', 'fair-events')}
										</a>
									</strong>
								</td>
								<td>{post.post_type_label}</td>
								<td>{post.author}</td>
								<td>{post.date}</td>
								<td>
									<Button
										variant="primary"
										size="small"
										onClick={() => handleMigrate(post.id)}
										isBusy={isMigrating === post.id}
										disabled={isMigrating !== null}
									>
										{isMigrating === post.id
											? __('Migrating...', 'fair-events')
											: __('Migrate', 'fair-events')}
									</Button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}
