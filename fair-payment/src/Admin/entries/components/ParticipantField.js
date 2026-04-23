/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	TextControl,
	Button,
	Spinner,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const ParticipantField = ({ participantId, participant, onChange }) => {
	const [search, setSearch] = useState('');
	const [results, setResults] = useState([]);
	const [isSearching, setIsSearching] = useState(false);
	const [showDropdown, setShowDropdown] = useState(false);
	const debounceRef = useRef(null);
	const wrapperRef = useRef(null);

	useEffect(() => {
		const handleClickOutside = (event) => {
			if (
				wrapperRef.current &&
				!wrapperRef.current.contains(event.target)
			) {
				setShowDropdown(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () =>
			document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	useEffect(() => {
		if (search.length < 2) {
			setResults([]);
			setShowDropdown(false);
			return;
		}

		clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(async () => {
			setIsSearching(true);
			try {
				const data = await apiFetch({
					path: `/fair-audience/v1/participants?search=${encodeURIComponent(
						search
					)}&per_page=10`,
				});
				setResults(data);
				setShowDropdown(true);
			} catch {
				setResults([]);
			} finally {
				setIsSearching(false);
			}
		}, 300);

		return () => clearTimeout(debounceRef.current);
	}, [search]);

	const handleSelect = (p) => {
		onChange(p.id, {
			id: p.id,
			name: [p.name, p.surname].filter(Boolean).join(' '),
			email: p.email,
		});
		setSearch('');
		setShowDropdown(false);
	};

	const handleClear = () => {
		onChange(null, null);
		setSearch('');
	};

	if (participantId && participant) {
		return (
			<div>
				<label
					style={{
						display: 'block',
						marginBottom: '4px',
						fontWeight: 600,
						fontSize: '11px',
						textTransform: 'uppercase',
					}}
				>
					{__('Participant', 'fair-payment')}
				</label>
				<HStack spacing={2}>
					<span>
						{participant.name}
						{participant.email && (
							<span style={{ color: '#757575' }}>
								{' '}
								({participant.email})
							</span>
						)}
					</span>
					<Button
						variant="tertiary"
						size="small"
						isDestructive
						onClick={handleClear}
					>
						{__('Remove', 'fair-payment')}
					</Button>
				</HStack>
			</div>
		);
	}

	return (
		<div ref={wrapperRef} style={{ position: 'relative' }}>
			<TextControl
				label={__('Participant', 'fair-payment')}
				value={search}
				onChange={setSearch}
				placeholder={__('Search by name or email…', 'fair-payment')}
				help={__('Link this transfer to a participant', 'fair-payment')}
				autoComplete="off"
			/>
			{isSearching && (
				<div
					style={{ position: 'absolute', right: '8px', top: '28px' }}
				>
					<Spinner />
				</div>
			)}
			{showDropdown && results.length > 0 && (
				<ul
					style={{
						position: 'absolute',
						zIndex: 100,
						background: '#fff',
						border: '1px solid #ddd',
						borderRadius: '2px',
						maxHeight: '200px',
						overflowY: 'auto',
						width: '100%',
						margin: '-8px 0 0',
						padding: 0,
						listStyle: 'none',
						boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
					}}
				>
					{results.map((p) => (
						<li
							key={p.id}
							style={{
								padding: '8px 12px',
								cursor: 'pointer',
								borderBottom: '1px solid #f0f0f0',
							}}
							onMouseDown={() => handleSelect(p)}
						>
							<strong>
								{[p.name, p.surname].filter(Boolean).join(' ')}
							</strong>
							{p.email && (
								<span style={{ color: '#757575' }}>
									{' '}
									— {p.email}
								</span>
							)}
						</li>
					))}
				</ul>
			)}
			{showDropdown && results.length === 0 && !isSearching && (
				<div
					style={{
						position: 'absolute',
						zIndex: 100,
						background: '#fff',
						border: '1px solid #ddd',
						borderRadius: '2px',
						width: '100%',
						margin: '-8px 0 0',
						padding: '8px 12px',
						color: '#757575',
						boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
					}}
				>
					{__('No participants found.', 'fair-payment')}
				</div>
			)}
		</div>
	);
};

export default ParticipantField;
