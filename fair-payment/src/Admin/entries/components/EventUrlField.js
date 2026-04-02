/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	TextControl,
	Button,
	Spinner,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const isUrl = (text) => /^https?:\/\//i.test(text.trim());

const EventUrlField = ({ value, eventDateId, onChange }) => {
	const [mode, setMode] = useState(value ? 'manual' : 'search');
	const [searchTerm, setSearchTerm] = useState('');
	const [searchResults, setSearchResults] = useState([]);
	const [isSearching, setIsSearching] = useState(false);

	useEffect(() => {
		if (mode !== 'search' || searchTerm.length < 2 || isUrl(searchTerm)) {
			setSearchResults([]);
			return;
		}

		const timeout = setTimeout(async () => {
			setIsSearching(true);
			try {
				const params = new URLSearchParams();
				params.append('search', searchTerm);
				params.append('per_page', 10);
				params.append('include_sources', true);
				const data = await apiFetch({
					path: `/fair-events/v1/event-dates?${params.toString()}`,
				});
				setSearchResults(
					(Array.isArray(data) ? data : []).filter(
						(ed) => ed.display_url
					)
				);
			} catch {
				setSearchResults([]);
			} finally {
				setIsSearching(false);
			}
		}, 300);

		return () => clearTimeout(timeout);
	}, [searchTerm, mode]);

	if (value) {
		return (
			<div>
				<div style={{ marginBottom: '4px', fontWeight: '600' }}>
					{__('Event', 'fair-payment')}
				</div>
				<HStack spacing={2}>
					<a
						href={value}
						target="_blank"
						rel="noopener noreferrer"
						style={{ wordBreak: 'break-all' }}
					>
						{value}
					</a>
					<Button
						variant="tertiary"
						size="small"
						isDestructive
						onClick={() => onChange('', null)}
					>
						{__('Clear', 'fair-payment')}
					</Button>
				</HStack>
			</div>
		);
	}

	return (
		<div>
			<div style={{ marginBottom: '4px', fontWeight: '600' }}>
				{__('Event', 'fair-payment')}
			</div>
			{mode === 'search' && (
				<div>
					<TextControl
						value={searchTerm}
						onChange={setSearchTerm}
						placeholder={__(
							'Search events or paste a URL...',
							'fair-payment'
						)}
						autoComplete="off"
					/>
					{isUrl(searchTerm) && (
						<Button
							variant="primary"
							size="small"
							style={{ marginBottom: '8px' }}
							onClick={() => {
								onChange(searchTerm.trim(), null);
								setSearchTerm('');
							}}
						>
							{__('Use this URL', 'fair-payment')}
						</Button>
					)}
					{isSearching && <Spinner />}
					{searchResults.length > 0 && (
						<div
							style={{
								border: '1px solid #ddd',
								borderRadius: '4px',
								maxHeight: '200px',
								overflowY: 'auto',
							}}
						>
							{searchResults.map((event) => (
								<div
									key={event.id}
									style={{
										padding: '8px 12px',
										cursor: 'pointer',
										borderBottom: '1px solid #eee',
									}}
									onClick={() => {
										const isExternalSource = String(
											event.id
										).startsWith('source_');
										onChange(
											event.display_url,
											isExternalSource ? null : event.id
										);
										setSearchTerm('');
										setSearchResults([]);
									}}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											const isExternalSource = String(
												event.id
											).startsWith('source_');
											onChange(
												event.display_url,
												isExternalSource
													? null
													: event.id
											);
											setSearchTerm('');
											setSearchResults([]);
										}
									}}
									role="button"
									tabIndex={0}
								>
									<strong>{event.title}</strong>
									<div
										style={{
											fontSize: '12px',
											color: '#666',
										}}
									>
										{event.start_datetime?.split('T')[0] ||
											event.start_datetime?.split(' ')[0]}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
};

export default EventUrlField;
