import { __ } from '@wordpress/i18n';
import { useState, useEffect, useCallback } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Button, SearchControl, Spinner, Notice } from '@wordpress/components';
import { Icon, warning } from '@wordpress/icons';

/**
 * Component for linking a participant to a WordPress user.
 *
 * @param {Object}   props              Component props.
 * @param {Object}   props.linkedUser   Currently linked WP user object { id, display_name, email } or null.
 * @param {string}   props.participantEmail Participant's email for auto-suggestion matching.
 * @param {Function} props.onLink       Callback when a user is linked. Receives user object.
 * @param {Function} props.onUnlink     Callback when user is unlinked.
 */
export default function UserLinkSection( {
	linkedUser,
	participantEmail,
	onLink,
	onUnlink,
} ) {
	const [ searchTerm, setSearchTerm ] = useState( '' );
	const [ searchResults, setSearchResults ] = useState( [] );
	const [ isSearching, setIsSearching ] = useState( false );
	const [ suggestedUser, setSuggestedUser ] = useState( null );
	const [ hasFetchedSuggestion, setHasFetchedSuggestion ] = useState( false );

	// Auto-suggest user by email when participantEmail changes.
	useEffect( () => {
		if ( ! participantEmail || linkedUser || hasFetchedSuggestion ) {
			return;
		}

		setHasFetchedSuggestion( true );

		apiFetch( {
			path: `/wp/v2/users?search=${ encodeURIComponent(
				participantEmail
			) }`,
		} )
			.then( ( users ) => {
				// Find exact email match.
				const match = users.find(
					( user ) =>
						user.email &&
						user.email.toLowerCase() ===
							participantEmail.toLowerCase()
				);
				if ( match ) {
					setSuggestedUser( {
						id: match.id,
						display_name: match.name,
						email: match.email,
					} );
				}
			} )
			.catch( () => {
				// Ignore search errors for auto-suggestion.
			} );
	}, [ participantEmail, linkedUser, hasFetchedSuggestion ] );

	// Search for users when search term changes.
	const handleSearch = useCallback( ( value ) => {
		setSearchTerm( value );

		if ( value.length < 2 ) {
			setSearchResults( [] );
			return;
		}

		setIsSearching( true );

		apiFetch( {
			path: `/wp/v2/users?search=${ encodeURIComponent( value ) }`,
		} )
			.then( ( users ) => {
				setSearchResults(
					users.map( ( user ) => ( {
						id: user.id,
						display_name: user.name,
						email: user.email,
					} ) )
				);
				setIsSearching( false );
			} )
			.catch( () => {
				setSearchResults( [] );
				setIsSearching( false );
			} );
	}, [] );

	const handleSelectUser = ( user ) => {
		onLink( user );
		setSearchTerm( '' );
		setSearchResults( [] );
		setSuggestedUser( null );
	};

	const handleUnlink = () => {
		onUnlink();
		setSuggestedUser( null );
		setHasFetchedSuggestion( false );
	};

	// Check if there's an email mismatch between participant and linked WP user.
	const hasEmailMismatch =
		linkedUser &&
		participantEmail &&
		linkedUser.email &&
		linkedUser.email.toLowerCase() !== participantEmail.toLowerCase();

	// If user is already linked, show the linked user info.
	if ( linkedUser ) {
		return (
			<div className="user-link-section">
				<p style={ { marginBottom: '8px' } }>
					<strong>{ __( 'WordPress User', 'fair-audience' ) }</strong>
				</p>
				<div
					style={ {
						display: 'flex',
						alignItems: 'center',
						gap: '8px',
						padding: '8px',
						backgroundColor: '#f0f0f0',
						borderRadius: '4px',
					} }
				>
					<span>
						{ linkedUser.display_name }
						{ linkedUser.email && ` (${ linkedUser.email })` }
					</span>
					{ hasEmailMismatch && (
						<span
							title={ __(
								'Email addresses do not match',
								'fair-audience'
							) }
							style={ { color: '#d63638' } }
						>
							<Icon icon={ warning } size={ 20 } />
						</span>
					) }
					<Button
						variant="secondary"
						isDestructive
						size="small"
						onClick={ handleUnlink }
					>
						{ __( 'Unlink', 'fair-audience' ) }
					</Button>
				</div>
				{ hasEmailMismatch && (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'The participant email does not match the WordPress user email.',
							'fair-audience'
						) }
					</Notice>
				) }
			</div>
		);
	}

	// Show suggestion if available.
	const showSuggestion = suggestedUser && ! searchTerm;

	return (
		<div className="user-link-section">
			<p style={ { marginBottom: '8px' } }>
				<strong>{ __( 'WordPress User', 'fair-audience' ) }</strong>
			</p>

			{ showSuggestion && (
				<Notice
					status="info"
					isDismissible={ false }
					style={ { marginBottom: '8px' } }
				>
					{ __(
						'Suggested user with matching email:',
						'fair-audience'
					) }{ ' ' }
					<strong>{ suggestedUser.display_name }</strong>
					<Button
						variant="link"
						onClick={ () => handleSelectUser( suggestedUser ) }
						style={ { marginLeft: '8px' } }
					>
						{ __( 'Link this user', 'fair-audience' ) }
					</Button>
				</Notice>
			) }

			<SearchControl
				label={ __( 'Search WordPress users', 'fair-audience' ) }
				value={ searchTerm }
				onChange={ handleSearch }
				placeholder={ __(
					'Search by name or email (min 2 chars)',
					'fair-audience'
				) }
			/>

			{ isSearching && (
				<div style={ { marginTop: '8px' } }>
					<Spinner />
				</div>
			) }

			{ ! isSearching && searchResults.length > 0 && (
				<ul
					style={ {
						listStyle: 'none',
						margin: '8px 0 0',
						padding: 0,
						border: '1px solid #ddd',
						borderRadius: '4px',
						maxHeight: '200px',
						overflowY: 'auto',
					} }
				>
					{ searchResults.map( ( user ) => (
						<li
							key={ user.id }
							style={ {
								padding: '8px 12px',
								borderBottom: '1px solid #eee',
								cursor: 'pointer',
							} }
							onClick={ () => handleSelectUser( user ) }
							onKeyDown={ ( e ) => {
								if ( e.key === 'Enter' || e.key === ' ' ) {
									handleSelectUser( user );
								}
							} }
							tabIndex={ 0 }
							role="option"
							aria-selected="false"
						>
							{ user.display_name }
							{ user.email && (
								<span
									style={ {
										color: '#666',
										marginLeft: '8px',
									} }
								>
									({ user.email })
								</span>
							) }
						</li>
					) ) }
				</ul>
			) }

			{ ! isSearching &&
				searchTerm.length >= 2 &&
				searchResults.length === 0 && (
					<p style={ { marginTop: '8px', color: '#666' } }>
						{ __( 'No users found.', 'fair-audience' ) }
					</p>
				) }
		</div>
	);
}
