/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef } from '@wordpress/element';

/**
 * Internal dependencies
 */
import CustomMail from './CustomMail.js';
import MailDetail from './MailDetail.js';
import { getMessageId, viewUrl } from './mail-route.js';

/**
 * Custom Mail page: the composer with Mail History, or one recorded message.
 *
 * The view follows the address (`&message_id=<id>`), so a message can be
 * linked to directly and Back/Forward work. Moving between the views inside
 * the page keeps the composer mounted, only hidden, so its draft, recipient
 * selection and exclusions survive a look at a past message. A direct visit
 * to a message does not start the composer until Mail History is shown.
 *
 * @return {JSX.Element} The page.
 */
export default function CustomMailApp() {
	const [ messageId, setMessageId ] = useState( () => getMessageId() );
	const [ composerStarted, setComposerStarted ] = useState(
		() => messageId === null
	);
	// Whether the detail was opened from this page (focus moves into it).
	const [ openedInPage, setOpenedInPage ] = useState( false );
	// History record whose subject link takes focus on return.
	const [ focusMailId, setFocusMailId ] = useState( null );
	// The message on screen, for the popstate listener registered once.
	const shownId = useRef( messageId );
	shownId.current = messageId;

	const showHistory = ( returnFrom ) => {
		setMessageId( null );
		setComposerStarted( true );
		setFocusMailId( returnFrom );
	};

	useEffect( () => {
		const handlePopState = () => {
			const id = getMessageId();
			if ( id === null ) {
				showHistory( shownId.current );
				return;
			}
			setOpenedInPage( true );
			setFocusMailId( null );
			setMessageId( id );
		};
		window.addEventListener( 'popstate', handlePopState );
		return () => window.removeEventListener( 'popstate', handlePopState );
	}, [] );

	const openMail = ( mail ) => {
		window.history.pushState(
			{ fairAudienceMailFrom: 'history' },
			'',
			viewUrl( mail.id )
		);
		setOpenedInPage( true );
		setFocusMailId( null );
		setMessageId( mail.id );
	};

	const backToHistory = () => {
		// Opened from the history in this tab: step back, so Forward reopens
		// the message and the history entry is not duplicated.
		if ( window.history.state?.fairAudienceMailFrom === 'history' ) {
			window.history.back();
			return;
		}
		window.history.pushState( null, '', viewUrl( null ) );
		showHistory( messageId );
	};

	return (
		<>
			{ composerStarted && (
				<div hidden={ messageId !== null }>
					<CustomMail
						onOpenMail={ openMail }
						focusMailId={ focusMailId }
					/>
				</div>
			) }
			{ messageId !== null && (
				<MailDetail
					key={ messageId }
					id={ messageId }
					onBack={ backToHistory }
					focusOnLoad={ openedInPage }
				/>
			) }
		</>
	);
}
