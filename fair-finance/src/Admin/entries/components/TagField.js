/**
 * WordPress dependencies
 */
import { useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { TextControl } from '@wordpress/components';

const TagField = ( { value, tags, onChange } ) => {
	const [ showSuggestions, setShowSuggestions ] = useState( false );
	const containerRef = useRef( null );
	const reopenOnFocus = useRef( true );

	const filtered =
		value && tags
			? tags.filter(
					( t ) =>
						t.toLowerCase().includes( value.toLowerCase() ) &&
						t !== value
				)
			: [];

	const select = ( tag ) => {
		onChange( tag );
		setShowSuggestions( false );
		// The chosen suggestion disappears; keep focus in the field without
		// reopening the list it was just picked from.
		reopenOnFocus.current = false;
		containerRef.current?.querySelector( 'input' )?.focus();
		reopenOnFocus.current = true;
	};

	return (
		// The wrapper only observes focus and Escape from the input and the
		// suggestion buttons inside it; it is not a control itself.
		// eslint-disable-next-line jsx-a11y/no-static-element-interactions
		<div
			ref={ containerRef }
			style={ { position: 'relative' } }
			// Keep the suggestions open while focus moves between the input
			// and a suggestion, so they can be reached with Tab.
			onBlur={ ( e ) => {
				if ( ! e.currentTarget.contains( e.relatedTarget ) ) {
					setShowSuggestions( false );
				}
			} }
			onKeyDown={ ( e ) => {
				if ( e.key === 'Escape' && showSuggestions ) {
					// Close the list without dismissing the surrounding modal.
					e.stopPropagation();
					setShowSuggestions( false );
				}
			} }
		>
			<TextControl
				label={ __( 'Tag', 'fair-finance' ) }
				value={ value || '' }
				onChange={ ( v ) => {
					onChange( v );
					setShowSuggestions( true );
				} }
				onFocus={ () => {
					if ( reopenOnFocus.current ) {
						setShowSuggestions( true );
					}
				} }
				placeholder={ __(
					'e.g. venue, catering, travel',
					'fair-finance'
				) }
				autoComplete="off"
				__next40pxDefaultSize
				__nextHasNoMarginBottom
			/>
			{ showSuggestions && filtered.length > 0 && (
				<div
					style={ {
						position: 'absolute',
						zIndex: 100,
						background: '#fff',
						border: '1px solid #ddd',
						borderRadius: '4px',
						maxHeight: '200px',
						overflowY: 'auto',
						width: '100%',
					} }
				>
					{ filtered.map( ( tag ) => (
						<div
							key={ tag }
							style={ {
								padding: '8px 12px',
								cursor: 'pointer',
								borderBottom: '1px solid #eee',
							} }
							onMouseDown={ ( e ) => {
								// Select before the input loses focus.
								e.preventDefault();
								select( tag );
							} }
							role="button"
							tabIndex={ 0 }
							onKeyDown={ ( e ) => {
								if ( e.key === 'Enter' || e.key === ' ' ) {
									e.preventDefault();
									select( tag );
								}
							} }
						>
							{ tag }
						</div>
					) ) }
				</div>
			) }
		</div>
	);
};

export default TagField;
