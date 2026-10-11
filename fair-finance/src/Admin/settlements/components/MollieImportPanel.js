/**
 * WordPress dependencies
 */
import { useEffect } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	Button,
	Card,
	CardBody,
	Notice,
	Spinner,
	__experimentalHStack as HStack,
	__experimentalText as Text,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import useImportRun from '../useImportRun.js';

const SETTINGS_URL = 'admin.php?page=fair-payments-connector-settings';

/**
 * Describe how far a run has come.
 *
 * @param {Object} run Import run.
 * @return {string} Progress sentence.
 */
const progressText = ( run ) => {
	const done = run.progress.settlements_done;
	return sprintf(
		/* translators: %d: number of settlements loaded so far */
		_n(
			'%d settlement loaded so far.',
			'%d settlements loaded so far.',
			done,
			'fair-finance'
		),
		done
	);
};

/**
 * Loads settlements from Mollie in resumable batches.
 *
 * @param {Object}      props
 * @param {Object|null} props.connection What the Mollie connection allows.
 * @param {Object|null} props.openRun    Run that was open when the page loaded.
 * @param {Function}    props.onChanged  Called when saved settlements changed.
 * @return {JSX.Element} Panel.
 */
export default function MollieImportPanel( {
	connection,
	openRun,
	onChanged,
} ) {
	const { run, working, error, start, resume, adopt } = useImportRun( {
		onFinished: onChanged,
	} );

	// Reopening the page picks up a run that was left unfinished.
	useEffect( () => {
		if ( openRun ) {
			adopt( openRun );
		}
	}, [ openRun, adopt ] );

	const canImport = connection?.can_import === true;
	const unfinished =
		! working &&
		run &&
		( run.resumable || run.status === 'running' ) &&
		run.kind === 'history';
	const completed = ! working && run?.status === 'completed';
	const stopped = ! working && run?.status === 'aborted';

	return (
		<Card className="fair-finance-settlements-import">
			<CardBody>
				<VStack spacing={ 3 }>
					<Text weight={ 600 } size={ 14 }>
						{ __( 'Load from Mollie', 'fair-finance' ) }
					</Text>
					<Text variant="muted">
						{ __(
							'Loads every settlement Mollie lists for the connected organization, with its payments, captures, refunds and chargebacks. Settlements already saved are refreshed, not duplicated.',
							'fair-finance'
						) }
					</Text>

					{ connection && ! canImport && (
						<Notice
							status="warning"
							isDismissible={ false }
							actions={ [
								{
									label: __(
										'Open Mollie connection settings',
										'fair-finance'
									),
									url: SETTINGS_URL,
									variant: 'link',
								},
							] }
						>
							{ connection.problem_message }{ ' ' }
							{ __(
								'Saved settlements and CSV import keep working.',
								'fair-finance'
							) }
						</Notice>
					) }

					{ error && (
						<Notice status="error" isDismissible={ false }>
							{ error }
						</Notice>
					) }

					{ working && run && (
						<HStack justify="flex-start" role="status">
							<Spinner />
							<Text>{ progressText( run ) }</Text>
						</HStack>
					) }

					{ unfinished && (
						<Notice status="warning" isDismissible={ false }>
							<strong>
								{ __(
									'An import from Mollie did not finish.',
									'fair-finance'
								) }
							</strong>{ ' ' }
							{ run.error_message } { progressText( run ) }
						</Notice>
					) }

					{ stopped && (
						<Notice status="error" isDismissible={ false }>
							{ run.error_message }
						</Notice>
					) }

					{ completed && (
						<Notice status="success" isDismissible={ false }>
							{ sprintf(
								/* translators: %d: number of settlements loaded */
								_n(
									'Loaded %d settlement from Mollie.',
									'Loaded %d settlements from Mollie.',
									run.progress.settlements_done,
									'fair-finance'
								),
								run.progress.settlements_done
							) }
						</Notice>
					) }

					<HStack justify="flex-start" wrap>
						{ unfinished && (
							<Button
								variant="primary"
								onClick={ resume }
								disabled={ ! canImport }
							>
								{ __( 'Continue import', 'fair-finance' ) }
							</Button>
						) }
						<Button
							variant={ unfinished ? 'secondary' : 'primary' }
							onClick={ () => start( 'history' ) }
							disabled={
								working ||
								! canImport ||
								run?.status === 'running'
							}
							isBusy={ working }
						>
							{ unfinished
								? __( 'Start over', 'fair-finance' )
								: __(
										'Load settlements from Mollie',
										'fair-finance'
								  ) }
						</Button>
					</HStack>
				</VStack>
			</CardBody>
		</Card>
	);
}
