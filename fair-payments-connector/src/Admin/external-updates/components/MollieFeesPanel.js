/**
 * WordPress dependencies
 */
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	SelectControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import MollieFeeFeedback from './MollieFeeFeedback.js';
import useMollieFeeLoad, { MOLLIE_FEES_ACTION } from '../useMollieFeeLoad.js';

/**
 * Load Mollie fee data for paid transactions that lack it.
 *
 * @param {Object}   props
 * @param {string}   props.activeAction Key of the action running on the page, or null.
 * @param {Function} props.onBegin      Claims the page-wide busy state; returns false when busy.
 * @param {Function} props.onEnd        Releases the busy state and refreshes the log.
 * @return {JSX.Element} Panel.
 */
const MollieFeesPanel = ( { activeAction, onBegin, onEnd } ) => {
	const [ mode, setMode ] = useState( 'live' );
	const { load, progress, result, clearResult } = useMollieFeeLoad( {
		onBegin,
		onEnd,
	} );

	const running = activeAction === MOLLIE_FEES_ACTION;

	return (
		<Card>
			<CardHeader>
				<h2 className="fair-external-updates__title">
					{ __( 'Mollie fees', 'fair-payments-connector' ) }
				</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 3 }>
					<p className="fair-external-updates__intro">
						{ __(
							'Fetch the Mollie processing fee for paid transactions that do not have one yet.',
							'fair-payments-connector'
						) }
					</p>
					<MollieFeeFeedback
						progress={ progress }
						result={ result }
						clearResult={ clearResult }
					/>
					<div className="fair-external-updates__fields">
						<SelectControl
							label={ __(
								'Transactions',
								'fair-payments-connector'
							) }
							value={ mode }
							options={ [
								{
									label: __(
										'Live mode',
										'fair-payments-connector'
									),
									value: 'live',
								},
								{
									label: __(
										'Test mode',
										'fair-payments-connector'
									),
									value: 'test',
								},
								{
									label: __(
										'All modes',
										'fair-payments-connector'
									),
									value: '',
								},
							] }
							onChange={ setMode }
							disabled={ running }
							__nextHasNoMarginBottom
						/>
					</div>
					<HStack justify="flex-start">
						<Button
							variant="primary"
							onClick={ () => load( mode ) }
							isBusy={ running }
							disabled={ activeAction !== null }
						>
							{ running
								? __(
										'Loading fees…',
										'fair-payments-connector'
								  )
								: __(
										'Load missing Mollie fees',
										'fair-payments-connector'
								  ) }
						</Button>
					</HStack>
				</VStack>
			</CardBody>
		</Card>
	);
};

export default MollieFeesPanel;
