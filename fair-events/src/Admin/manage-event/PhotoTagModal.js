import { useState, useEffect } from '@wordpress/element';
import { Modal, TextControl, Button, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

export default function PhotoTagModal({ eventId, onSelect, onClose }) {
	const [participants, setParticipants] = useState([]);
	const [loading, setLoading] = useState(true);
	const [search, setSearch] = useState('');

	useEffect(() => {
		apiFetch({
			path: `/fair-audience/v1/events/${eventId}/participants`,
		})
			.then((data) => {
				setParticipants(data || []);
			})
			.catch(() => {
				setParticipants([]);
			})
			.finally(() => setLoading(false));
	}, [eventId]);

	const filtered = participants.filter((p) => {
		const fullName = `${p.name || ''} ${p.surname || ''}`.toLowerCase();
		return fullName.includes(search.toLowerCase());
	});

	return (
		<Modal
			title={__('Tag a Participant', 'fair-events')}
			onRequestClose={onClose}
		>
			<TextControl
				placeholder={__('Search participants...', 'fair-events')}
				value={search}
				onChange={setSearch}
			/>
			{loading && <Spinner />}
			{!loading && filtered.length === 0 && (
				<p>{__('No participants found.', 'fair-events')}</p>
			)}
			<div
				style={{
					maxHeight: '300px',
					overflowY: 'auto',
				}}
			>
				{filtered.map((p) => (
					<Button
						key={p.id}
						variant="secondary"
						style={{
							display: 'block',
							width: '100%',
							textAlign: 'left',
							marginBottom: '4px',
						}}
						onClick={() => onSelect(p)}
					>
						{`${p.name || ''} ${p.surname || ''}`.trim()}
					</Button>
				))}
			</div>
		</Modal>
	);
}
