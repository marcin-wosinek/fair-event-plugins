/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
} from '@wordpress/components';

/**
 * Frame of one channel section: heading with the unsaved marker, notices,
 * and the save, preview and test buttons. The channel supplies its own
 * controls, explanations, results and history.
 *
 * Preview and test use the saved settings, so both wait for unsaved changes;
 * the channel explains that in `notes`.
 *
 * @param {Object}      props
 * @param {string}      props.title              Channel name.
 * @param {Object}      props.editor             Result of useNotificationEditor().
 * @param {string|null} props.unavailableMessage Why the channel cannot be edited now, if it cannot.
 * @param {string}      props.saveLabel          Save button label.
 * @param {string}      props.previewLabel       Preview button label.
 * @param {string}      props.testLabel          Test button label.
 * @param {boolean}     props.testBlocked        Whether the test cannot be sent, besides unsaved changes.
 * @param {Array}       props.notes              Explanations shown below the buttons.
 * @param {*}           props.children           Description, notices and controls above the buttons.
 * @param {*}           props.after              Results, preview and history below the explanations.
 * @return {JSX.Element} The section.
 */
export default function NotificationEditor( {
	title,
	editor,
	unavailableMessage = null,
	saveLabel,
	previewLabel,
	testLabel,
	testBlocked = false,
	notes = [],
	children,
	after,
} ) {
	const { dirty, pending } = editor;

	const header = (
		<CardHeader>
			<h2>{ title }</h2>
			{ dirty && (
				<span className="fair-events-notifications__unsaved">
					{ __( 'Unsaved changes', 'fair-events' ) }
				</span>
			) }
		</CardHeader>
	);

	if ( unavailableMessage ) {
		return (
			<Card className="fair-events-notifications__channel">
				{ header }
				<CardBody>
					<Notice status="warning" isDismissible={ false }>
						{ unavailableMessage }
					</Notice>
					{ dirty && (
						<p className="description">
							{ __(
								'Your unsaved changes are kept and shown again here once this channel is available.',
								'fair-events'
							) }
						</p>
					) }
				</CardBody>
			</Card>
		);
	}

	return (
		<Card className="fair-events-notifications__channel">
			{ header }
			<CardBody>
				{ children }

				{ editor.conflict && (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'These settings were saved somewhere else, for example in another tab, after you started editing. Saving replaces them with the values shown here.',
							'fair-events'
						) }
					</Notice>
				) }

				{ editor.notice && (
					<Notice
						status={ editor.notice.status }
						onRemove={ editor.dismissNotice }
					>
						{ editor.notice.message }
					</Notice>
				) }

				<div className="fair-events-notifications__actions">
					<Button
						variant="primary"
						onClick={ editor.save }
						isBusy={ pending.save }
						disabled={
							pending.save || pending.test || !! editor.problem
						}
					>
						{ saveLabel }
					</Button>
					<Button
						variant="secondary"
						onClick={ editor.loadPreview }
						isBusy={ pending.preview }
						disabled={ pending.preview || dirty }
					>
						{ previewLabel }
					</Button>
					<Button
						variant="secondary"
						onClick={ editor.sendTest }
						isBusy={ pending.test }
						disabled={
							pending.save || pending.test || dirty || testBlocked
						}
					>
						{ testLabel }
					</Button>
				</div>
				{ editor.problem && (
					<p className="description">{ editor.problem }</p>
				) }
				{ notes.filter( Boolean ).map( ( note, index ) => (
					<p key={ index } className="description">
						{ note }
					</p>
				) ) }

				{ after }
			</CardBody>
		</Card>
	);
}
