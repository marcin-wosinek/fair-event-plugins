<?php
/**
 * Mollie settlement report lines and their summary.
 *
 * Fixtures are synthetic; they are not taken from a real settlement.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Settlements;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Settlements\Movements;
use FairPaymentsConnector\Settlements\Report;

/**
 * Unit tests for Report.
 */
class ReportTest extends TestCase {

	/**
	 * A Mollie amount object.
	 *
	 * @param string $value    Value.
	 * @param string $currency Currency.
	 * @return array
	 */
	private function money( $value, $currency = 'EUR' ) {
		return array(
			'value'    => $value,
			'currency' => $currency,
		);
	}

	/**
	 * An aggregate movement carrying a report line.
	 *
	 * @param string      $group  Report group.
	 * @param string|null $gross  Gross value, or null when Mollie sent none.
	 * @param array       $fields Other Mollie fields of the line.
	 * @return array
	 */
	private function item( $group, $gross, array $fields = array() ) {
		$line = array_merge(
			array(
				'description' => 'Line',
				'method'      => 'ideal',
				'count'       => 1,
				'amountGross' => null === $gross ? null : $this->money( $gross ),
			),
			$fields
		);

		return Movements::make(
			array(
				'type'         => Report::GROUP_COSTS === $group ? Movements::TYPE_FEE : Movements::TYPE_SUMMARY,
				'is_aggregate' => true,
				'description'  => $line['description'],
				'report'       => Report::line( '2026', '05', $group, $line ),
			)
		);
	}

	/**
	 * The synthetic fee example: 0.7545 + 1.5300 + 1.3700 + 0.2500 - 0.0045 = 3.9000.
	 *
	 * @return array[]
	 */
	private function fee_items() {
		$items = array( $this->item( Report::GROUP_REVENUE, '40.00' ) );
		foreach ( array( '0.7545', '1.5300', '1.3700', '0.2500', '-0.0045' ) as $index => $gross ) {
			$items[] = $this->item( Report::GROUP_COSTS, $gross, array( 'description' => 'Cost ' . $index ) );
		}

		return $items;
	}

	/** Every field of a line is kept with its sign, scale and currency. */
	public function test_line_keeps_report_details_exactly() {
		$line = Report::line(
			'2026',
			'5',
			Report::GROUP_COSTS,
			array(
				'description' => 'Credit card',
				'method'      => 'creditcard',
				'count'       => 3,
				'rate'        => array(
					'fixed'      => $this->money( '0.25' ),
					'percentage' => '1.8',
				),
				'amountNet'   => $this->money( '2.0995' ),
				'amountVat'   => $this->money( '0.4415' ),
				'amountGross' => $this->money( '2.5410' ),
			),
			array(
				'invoiceId'        => 'inv_unit0001',
				'invoiceReference' => '2026.10001',
			)
		);

		$this->assertSame( '2026', $line['year'] );
		$this->assertSame( '05', $line['month'] );
		$this->assertSame( Report::GROUP_COSTS, $line['group'] );
		$this->assertSame( 'creditcard', $line['method'] );
		$this->assertSame( 3, $line['count'] );
		$this->assertSame( '0.25', $line['rate_fixed']['value'] );
		$this->assertSame( '1.8', $line['rate_percentage']['value'] );
		$this->assertSame( '2.0995', $line['amount_net']['value'] );
		$this->assertSame( '0.4415', $line['amount_vat']['value'] );
		$this->assertSame( '2.5410', $line['amount_gross']['value'] );
		$this->assertSame( 'EUR', $line['amount_gross']['currency'] );
		$this->assertSame( Report::STATE_PROVIDED, $line['amount_gross']['state'] );
		$this->assertSame( 'inv_unit0001', $line['invoice_id'] );
		$this->assertSame( '2026.10001', $line['invoice_reference'] );
		$this->assertFalse( Report::has_invalid_value( $line ) );
	}

	/** The older `variable` name of the percentage rate is read too. */
	public function test_line_reads_the_older_rate_name() {
		$line = Report::line( '2026', '05', Report::GROUP_COSTS, array( 'rate' => array( 'variable' => '2.9' ) ) );

		$this->assertSame( '2.9', $line['rate_percentage']['value'] );
	}

	/** Not sent, unreadable and zero are three different things. */
	public function test_missing_invalid_and_zero_stay_distinct() {
		$line = Report::line(
			'2026',
			'05',
			Report::GROUP_COSTS,
			array(
				'count'       => 0,
				'amountNet'   => $this->money( '0.0000' ),
				'amountVat'   => null,
				'amountGross' => $this->money( '1.123456789' ),
				'rate'        => array(
					'fixed'      => $this->money( '0.25', 'euro' ),
					'percentage' => 'variable',
				),
			)
		);

		$this->assertSame( 0, $line['count'] );
		$this->assertSame( Report::STATE_PROVIDED, $line['amount_net']['state'] );
		$this->assertSame( '0.0000', $line['amount_net']['value'] );
		$this->assertSame( Report::STATE_MISSING, $line['amount_vat']['state'] );
		$this->assertNull( $line['amount_vat']['value'] );
		// Too many decimals: refused, not cut short.
		$this->assertSame( Report::STATE_INVALID, $line['amount_gross']['state'] );
		$this->assertNull( $line['amount_gross']['value'] );
		$this->assertSame( Report::STATE_INVALID, $line['rate_fixed']['state'] );
		$this->assertSame( Report::STATE_INVALID, $line['rate_percentage']['state'] );
		$this->assertTrue( Report::has_invalid_value( $line ) );

		$absent = Report::line( '2026', '05', Report::GROUP_COSTS, array() );
		$this->assertNull( $absent['count'] );
		$this->assertSame( Report::STATE_MISSING, $absent['rate_fixed']['state'] );
		$this->assertSame( Report::STATE_MISSING, $absent['rate_percentage']['state'] );
		$this->assertFalse( Report::has_invalid_value( $absent ) );
	}

	/** Revenue adds and costs subtract; a negative cost increases the payout. */
	public function test_contribution_is_signed_by_group() {
		$revenue  = $this->item( Report::GROUP_REVENUE, '40.00' )['report'];
		$refund   = $this->item( Report::GROUP_REVENUE, '-10.00' )['report'];
		$cost     = $this->item( Report::GROUP_COSTS, '0.7545' )['report'];
		$rounding = $this->item( Report::GROUP_COSTS, '-0.0045' )['report'];

		$this->assertSame( '40.00', Report::contribution( $revenue )['value'] );
		$this->assertSame( '-10.00', Report::contribution( $refund )['value'] );
		$this->assertSame( '-0.7545', Report::contribution( $cost )['value'] );
		$this->assertSame( '0.0045', Report::contribution( $rounding )['value'] );
		// The stored report amounts keep Mollie's own signs.
		$this->assertSame( '0.7545', $cost['amount_gross']['value'] );
		$this->assertSame( '-0.0045', $rounding['amount_gross']['value'] );
	}

	/** The net amount stands in only when no gross amount was sent at all. */
	public function test_contribution_falls_back_to_net_only_when_gross_is_missing() {
		$net_only = $this->item( Report::GROUP_COSTS, null, array( 'amountNet' => $this->money( '1.2000' ) ) )['report'];
		$this->assertSame( '-1.2000', Report::contribution( $net_only )['value'] );

		$unreadable = $this->item(
			Report::GROUP_COSTS,
			'one',
			array( 'amountNet' => $this->money( '1.2000' ) )
		)['report'];
		$this->assertSame( Report::STATE_INVALID, Report::contribution( $unreadable )['state'] );
		$this->assertNull( Report::contribution( $unreadable )['value'] );
	}

	/** The fee example adds up exactly and equals the payout. */
	public function test_summary_adds_fractional_fees_and_matches_the_payout() {
		$summary = Report::summarize( '36.10', 'EUR', $this->fee_items() );

		$this->assertSame( '40.00', $summary['revenue']['amount'] );
		$this->assertSame( '-3.9000', $summary['costs']['amount'] );
		$this->assertSame( 5, $summary['costs']['lines'] );
		$this->assertSame( '36.1000', $summary['net'] );
		$this->assertSame( '0.0000', $summary['difference'] );
		$this->assertSame( 'verified', $summary['check'] );
		$this->assertTrue( $summary['complete'] );
	}

	/** A difference below one cent is reported, not rounded into agreement. */
	public function test_summary_exposes_a_sub_cent_residual() {
		$items = $this->fee_items();
		array_pop( $items ); // Without the rounding line.

		$summary = Report::summarize( '36.10', 'EUR', $items );

		$this->assertSame( '-3.9045', $summary['costs']['amount'] );
		$this->assertSame( '36.0955', $summary['net'] );
		$this->assertSame( '-0.0045', $summary['difference'] );
		$this->assertSame( 'mismatch', $summary['check'] );
	}

	/** Only Mollie's own method marks a refund; a description never does. */
	public function test_summary_separates_refunds_by_method_only() {
		$summary = Report::summarize(
			'20.00',
			'EUR',
			array(
				$this->item( Report::GROUP_REVENUE, '40.00' ),
				$this->item( Report::GROUP_REVENUE, '-15.00', array( 'method' => 'refund' ) ),
				$this->item(
					Report::GROUP_REVENUE,
					'-5.00',
					array(
						'method'      => 'ideal',
						'description' => 'Refunds iDEAL',
					)
				),
			)
		);

		$this->assertSame( '-15.00', $summary['refunds']['amount'] );
		$this->assertSame( 1, $summary['refunds']['lines'] );
		// The line that only reads like a refund stays generic revenue.
		$this->assertSame( '35.00', $summary['revenue']['amount'] );
		$this->assertSame( 0, $summary['costs']['lines'] );
		$this->assertNull( $summary['costs']['amount'] );
		$this->assertSame( 'verified', $summary['check'] );
	}

	/** A missing or unreadable amount leaves the report without a total. */
	public function test_summary_is_not_completed_from_partial_values() {
		$items   = $this->fee_items();
		$items[] = $this->item( Report::GROUP_COSTS, 'ten' );
		$items[] = $this->item( Report::GROUP_COSTS, null );

		$summary = Report::summarize( '36.10', 'EUR', $items );

		$this->assertSame( 1, $summary['invalid'] );
		$this->assertSame( 1, $summary['missing'] );
		$this->assertFalse( $summary['complete'] );
		$this->assertSame( '40.00', $summary['revenue']['amount'] );
		$this->assertNull( $summary['costs']['amount'] );
		$this->assertNull( $summary['net'] );
		$this->assertNull( $summary['difference'] );
		$this->assertSame( 'unavailable', $summary['check'] );
	}

	/** Amounts in another currency are never added to the report total. */
	public function test_summary_refuses_mixed_currencies() {
		$summary = Report::summarize(
			'36.10',
			'EUR',
			array(
				$this->item( Report::GROUP_REVENUE, '40.00' ),
				$this->item( Report::GROUP_COSTS, '3.90', array( 'amountGross' => $this->money( '3.90', 'USD' ) ) ),
			)
		);

		$this->assertSame( 1, $summary['other_currency'] );
		$this->assertNull( $summary['costs']['amount'] );
		$this->assertNull( $summary['net'] );
		$this->assertSame( 'unavailable', $summary['check'] );
	}

	/** Without a payout the report is totalled but cannot be compared. */
	public function test_summary_without_payout_is_not_compared() {
		$summary = Report::summarize( null, 'EUR', $this->fee_items() );

		$this->assertSame( '36.1000', $summary['net'] );
		$this->assertNull( $summary['difference'] );
		$this->assertSame( 'unavailable', $summary['check'] );
	}

	/** Movements without report details have no report to summarize. */
	public function test_summary_is_null_without_report_lines() {
		$legacy = Movements::make(
			array(
				'type'              => Movements::TYPE_FEE,
				'is_aggregate'      => true,
				'settlement_amount' => '-1.45',
			)
		);

		$this->assertNull( Report::summarize( '38.55', 'EUR', array( $legacy ) ) );
		$this->assertNull( Report::summarize( '38.55', 'EUR', array() ) );
	}

	/** A stored line comes back unchanged, and nothing outside the structure survives. */
	public function test_stored_line_round_trips_through_the_allowlist() {
		$line   = $this->item(
			Report::GROUP_COSTS,
			'0.7545',
			array(
				'amountVat' => $this->money( '0.1309' ),
				'rate'      => array(
					'fixed'      => $this->money( '0.3118' ),
					'percentage' => '1.8',
				),
			)
		)['report'];
		$stored = json_decode( (string) wp_json_encode( $line ), true );

		$this->assertSame( $line, Report::from_stored( $stored ) );

		$stored['consumerName']               = 'Jane Example';
		$stored['amount_gross']['consumerId'] = 'cst_unit0001';
		$this->assertSame( $line, Report::from_stored( $stored ) );

		$this->assertNull( Report::from_stored( null ) );
		$this->assertNull( Report::from_stored( array() ) );
	}

	/** Respelling a decimal does not change what identifies or hashes a line. */
	public function test_equivalent_spellings_have_the_same_material() {
		$a = $this->item( Report::GROUP_COSTS, '0.7500', array( 'amountNet' => $this->money( '0.62' ) ) )['report'];
		$b = $this->item( Report::GROUP_COSTS, '0.75', array( 'amountNet' => $this->money( '0.6200' ) ) )['report'];
		$c = $this->item( Report::GROUP_COSTS, '0.7545', array( 'amountNet' => $this->money( '0.62' ) ) )['report'];

		$this->assertSame( Report::material( $a ), Report::material( $b ) );
		$this->assertNotSame( Report::material( $a ), Report::material( $c ) );
	}
}
