/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect, useCallback } from '@wordpress/element';
import { Button, Spinner } from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import TimelineItem from './TimelineItem.js';

const PER_PAGE = 20;

/**
 * Timeline page component.
 *
 * @return {JSX.Element} Timeline page.
 */
export default function Timeline() {
	const [items, setItems] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [page, setPage] = useState(1);
	const [hasMore, setHasMore] = useState(false);

	const fetchItems = useCallback(async (pageNum, append = false) => {
		if (append) {
			setIsLoadingMore(true);
		} else {
			setIsLoading(true);
		}

		try {
			const response = await apiFetch({
				path: `/fair-audience/v1/timeline?per_page=${PER_PAGE}&page=${pageNum}`,
				parse: false,
			});

			const totalPages = parseInt(
				response.headers.get('X-WP-TotalPages'),
				10
			);
			const data = await response.json();

			if (append) {
				setItems((prev) => [...prev, ...data]);
			} else {
				setItems(data);
			}

			setHasMore(pageNum < totalPages);
		} catch {
			// Silently handle errors - items stay as they are.
		} finally {
			setIsLoading(false);
			setIsLoadingMore(false);
		}
	}, []);

	useEffect(() => {
		fetchItems(1);
	}, [fetchItems]);

	const handleLoadMore = () => {
		const nextPage = page + 1;
		setPage(nextPage);
		fetchItems(nextPage, true);
	};

	return (
		<div className="wrap">
			<h1>{__('Activity', 'fair-audience')}</h1>

			{isLoading && (
				<div
					style={{
						display: 'flex',
						justifyContent: 'center',
						padding: '40px 0',
					}}
				>
					<Spinner />
				</div>
			)}

			{!isLoading && items.length === 0 && (
				<p>{__('No activity yet.', 'fair-audience')}</p>
			)}

			{!isLoading && items.length > 0 && (
				<div style={{ maxWidth: '700px' }}>
					{items.map((item) => (
						<TimelineItem key={item.id} item={item} />
					))}

					{hasMore && (
						<div
							style={{
								textAlign: 'center',
								padding: '16px 0',
							}}
						>
							<Button
								variant="secondary"
								onClick={handleLoadMore}
								isBusy={isLoadingMore}
								disabled={isLoadingMore}
							>
								{isLoadingMore
									? __('Loading…', 'fair-audience')
									: __('Load more', 'fair-audience')}
							</Button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
