<?php
/**
 * Mollie settlement CSV parsing and validation.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Settlements;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Settlements\CsvParser;
use FairPaymentsConnector\Settlements\CsvValidationException;
use FairPaymentsConnector\Settlements\Movements;

/**
 * Unit tests for CsvParser.
 */
class CsvParserTest extends TestCase {

	const HEADER = 'Date,Payment method,Currency,Amount,Status,ID,Description,Settlement currency,Settlement amount,Settlement reference';

	/**
	 * Read a fixture file.
	 *
	 * @param string $name File name.
	 * @return string
	 */
	private function fixture( $name ) {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local test fixture.
		return (string) file_get_contents( __DIR__ . '/fixtures/' . $name );
	}

	/**
	 * Parse a file expected to be refused and return the problems found.
	 *
	 * @param string $contents File contents.
	 * @return array[]
	 */
	private function errors_for( $contents ) {
		try {
			CsvParser::parse( $contents );
		} catch ( CsvValidationException $e ) {
			return $e->get_errors();
		}
		$this->fail( 'The file was accepted.' );
	}

	/**
	 * Index movements by identity key.
	 *
	 * @param array[] $movements Movements.
	 * @return array<string, array>
	 */
	private function by_key( array $movements ) {
		$indexed = array();
		foreach ( $movements as $movement ) {
			$indexed[ $movement['identity_key'] ] = $movement;
		}
		return $indexed;
	}

	/** Every movement category of the English export is kept with exact values. */
	public function test_english_export_keeps_every_movement_category() {
		$parsed    = CsvParser::parse( $this->fixture( 'settlement-en.csv' ) );
		$movements = $this->by_key( $parsed['movements'] );

		$this->assertSame( 'en', $parsed['format'] );
		$this->assertSame( '19415110.2605.03', $parsed['facts']['reference'] );
		$this->assertSame( 'EUR', $parsed['facts']['currency'] );
		$this->assertCount( 9, $parsed['movements'] );

		$this->assertSame( Movements::TYPE_PAYMENT, $movements['payment:tr_fixtureAAA111#1']['type'] );
		$this->assertSame( Movements::TYPE_CAPTURE, $movements['capture:cpt_fixtureCCC333#1']['type'] );
		$this->assertSame( Movements::TYPE_REFUND, $movements['refund:re_fixtureDDD444#1']['type'] );
		$this->assertSame( Movements::TYPE_CHARGEBACK, $movements['chargeback:chb_fixtureEEE555#1']['type'] );
		$this->assertSame( '-15.00', $movements['chargeback:chb_fixtureEEE555#1']['settlement_amount'] );
		$this->assertSame( 'tr_fixtureAAA111', $movements['payment:tr_fixtureAAA111#1']['payment_reference'] );
		$this->assertSame( '2026-05-02 10:15:00', $movements['payment:tr_fixtureAAA111#1']['occurred_at'] );
	}

	/** The payout amount is not in the export, so it stays unknown rather than being derived. */
	public function test_payout_amount_stays_unknown() {
		$parsed = CsvParser::parse( $this->fixture( 'settlement-en.csv' ) );

		$this->assertNull( $parsed['facts']['amount'] );
		$this->assertNull( $parsed['facts']['provider_id'] );
		$this->assertNull( $parsed['facts']['status'] );
	}

	/** A payment in another currency keeps its original and its settlement amount apart. */
	public function test_original_and_settlement_currency_stay_distinct() {
		$movements = $this->by_key( CsvParser::parse( $this->fixture( 'settlement-en.csv' ) )['movements'] );
		$payment   = $movements['payment:tr_fixtureBBB222#1'];

		$this->assertSame( '40.00', $payment['amount'] );
		$this->assertSame( 'USD', $payment['currency'] );
		$this->assertSame( '36.80', $payment['settlement_amount'] );
		$this->assertSame( 'EUR', $payment['settlement_currency'] );
		$this->assertSame( 'Ticket B, front row', $payment['description'] );
	}

	/** Summed rows are aggregates, and two identical ones are both kept. */
	public function test_repeated_aggregate_rows_are_kept_apart() {
		$parsed = CsvParser::parse( $this->fixture( 'settlement-en.csv' ) );
		$fees   = array();
		foreach ( $parsed['movements'] as $movement ) {
			if ( Movements::TYPE_FEE === $movement['type'] ) {
				$fees[] = $movement;
			}
		}

		$this->assertCount( 2, $fees );
		$this->assertTrue( $fees[0]['is_aggregate'] );
		$this->assertSame( 1, $fees[0]['occurrence'] );
		$this->assertSame( 2, $fees[1]['occurrence'] );
		$this->assertNotSame( $fees[0]['identity_key'], $fees[1]['identity_key'] );
	}

	/** Aggregate rows are totalled apart from detail movements. */
	public function test_totals_keep_detail_and_aggregate_apart() {
		$totals = CsvParser::parse( $this->fixture( 'settlement-en.csv' ) )['totals'];

		$this->assertSame( '71.80', $totals['detail']['settlement_amount'] );
		$this->assertSame( 6, $totals['detail']['count'] );
		$this->assertSame( '-0.90', $totals['aggregate']['settlement_amount'] );
		$this->assertSame( '-2.90', $totals['by_type'][ Movements::TYPE_FEE ]['settlement_amount'] );
		$this->assertSame( '2.00', $totals['by_type'][ Movements::TYPE_ADJUSTMENT ]['settlement_amount'] );
	}

	/** A reference that is not a known Mollie type is kept and flagged for review. */
	public function test_unrecognized_movement_is_kept_for_review() {
		$movements = $this->by_key( CsvParser::parse( $this->fixture( 'settlement-en.csv' ) )['movements'] );
		$unknown   = $movements['unknown:xyz_fixtureFFF666#1'];

		$this->assertSame( Movements::TYPE_UNKNOWN, $unknown['type'] );
		$this->assertTrue( $unknown['needs_review'] );
		$this->assertSame( '5.00', $unknown['settlement_amount'] );
	}

	/** Consumer names and bank details never reach the parsed result. */
	public function test_consumer_details_are_not_retained() {
		$encoded = (string) wp_json_encode( CsvParser::parse( $this->fixture( 'settlement-en.csv' ) ) );

		$this->assertStringNotContainsString( 'Jane Example', $encoded );
		$this->assertStringNotContainsString( 'NL00BANK0123456789', $encoded );
		$this->assertStringNotContainsString( 'BANKNL2A', $encoded );
	}

	/** The Dutch export, with semicolons and comma decimals, reads to the same model. */
	public function test_dutch_export_is_supported() {
		$parsed    = CsvParser::parse( $this->fixture( 'settlement-nl.csv' ) );
		$movements = $this->by_key( $parsed['movements'] );

		$this->assertSame( 'nl', $parsed['format'] );
		$this->assertSame( '19415110.2605.03', $parsed['facts']['reference'] );
		$this->assertSame( '25.00', $movements['payment:tr_fixtureAAA111#1']['settlement_amount'] );
		// A refund listed under its payment is a refund, not a second payment.
		$this->assertSame( '-10.00', $movements['refund:tr_fixtureAAA111#1']['settlement_amount'] );
		$this->assertSame( '-0.29', $parsed['totals']['by_type'][ Movements::TYPE_FEE ]['settlement_amount'] );
	}

	/** A settlement of only fees and adjustments is valid. */
	public function test_settlement_without_payment_rows_is_accepted() {
		$parsed = CsvParser::parse( self::HEADER . "\n,,EUR,-3.00,,,Monthly fees,EUR,-3.00,REF.1\n" );

		$this->assertCount( 1, $parsed['movements'] );
		$this->assertSame( Movements::TYPE_FEE, $parsed['movements'][0]['type'] );
	}

	/** An empty amount cell is unknown, not zero. */
	public function test_missing_amount_stays_unknown() {
		$parsed = CsvParser::parse( self::HEADER . "\n,ideal,EUR,10.00,paid,tr_missing0001,Ticket,EUR,,REF.1\n" );

		$this->assertNull( $parsed['movements'][0]['settlement_amount'] );
		$this->assertNull( $parsed['movements'][0]['settlement_currency'] );
		$this->assertNull( $parsed['totals']['detail']['settlement_amount'] );
		$this->assertSame( 1, $parsed['totals']['detail']['unknown'] );
	}

	/** A title line before the header and a byte order mark are tolerated. */
	public function test_title_line_and_bom_are_tolerated() {
		$parsed = CsvParser::parse( "\xEF\xBB\xBFMollie settlement export\n" . self::HEADER . "\n,ideal,EUR,10.00,paid,tr_title00001,Ticket,EUR,10.00,REF.1\n" );

		$this->assertSame( 'REF.1', $parsed['facts']['reference'] );
	}

	/** The same file always hashes the same; a changed value hashes differently. */
	public function test_hash_tracks_material_content() {
		$original = self::HEADER . "\n,ideal,EUR,10.00,paid,tr_hash000001,Ticket,EUR,10.00,REF.1\n";
		$reworded = self::HEADER . "\n,ideal,EUR,10.00,paid,tr_hash000001,Ticket renamed,EUR,10.00,REF.1\n";
		$changed  = self::HEADER . "\n,ideal,EUR,10.00,paid,tr_hash000001,Ticket,EUR,9.00,REF.1\n";

		$this->assertSame( CsvParser::parse( $original )['hash'], CsvParser::parse( $original )['hash'] );
		$this->assertSame( CsvParser::parse( $original )['hash'], CsvParser::parse( $reworded )['hash'] );
		$this->assertNotSame( CsvParser::parse( $original )['hash'], CsvParser::parse( $changed )['hash'] );
	}

	/**
	 * Files that must be refused, and why.
	 *
	 * @return array[]
	 */
	public function invalid_files() {
		$row = ',ideal,EUR,10.00,paid,tr_invalid0001,Ticket,EUR,10.00,REF.1';

		return array(
			'empty'                     => array( "  \n", 'csv_empty', null ),
			'not utf-8'                 => array( self::HEADER . "\n,ideal,EUR,10.00,paid,tr_invalid0001,Caf\xE9,EUR,10.00,REF.1\n", 'csv_encoding', null ),
			'binary'                    => array( "PK\x03\x04\0\0binary", 'csv_encoding', null ),
			'unrelated csv'             => array( "name,email\nJane,jane@example.test\n", 'csv_headers_unsupported', null ),
			'missing required column'   => array( "Date,Currency,Amount,Status,ID\n,EUR,10.00,paid,tr_invalid0001\n", 'csv_headers_missing', null ),
			'header only'               => array( self::HEADER . "\n", 'csv_no_rows', null ),
			'thousands separator'       => array( self::HEADER . "\n" . str_replace( 'EUR,10.00,REF.1', 'EUR,"1,234",REF.1', $row ) . "\n", 'csv_amount_invalid', 2 ),
			'text amount'               => array( self::HEADER . "\n" . str_replace( ',EUR,10.00,paid', ',EUR,ten,paid', $row ) . "\n", 'csv_amount_invalid', 2 ),
			'bad currency'              => array( self::HEADER . "\n" . str_replace( ',ideal,EUR,', ',ideal,EURO,', $row ) . "\n", 'csv_currency_invalid', 2 ),
			'bad reference'             => array( self::HEADER . "\n" . str_replace( 'tr_invalid0001', 'not a reference', $row ) . "\n", 'csv_reference_invalid', 2 ),
			'two settlements'           => array( self::HEADER . "\n$row\n" . str_replace( 'REF.1', 'REF.2', $row ) . "\n", 'csv_multiple_settlements', 3 ),
			'two settlement currencies' => array( self::HEADER . "\n$row\n" . str_replace( 'EUR,10.00,REF.1', 'USD,10.00,REF.1', $row ) . "\n", 'csv_multiple_settlement_currencies', 3 ),
			'no settlement reference'   => array( self::HEADER . "\n" . str_replace( ',REF.1', ',', $row ) . "\n", 'csv_reference_missing', null ),
			'short row'                 => array( self::HEADER . "\n$row\n,ideal,EUR\n", 'csv_row_structure', 3 ),
		);
	}

	/**
	 * An invalid file is refused with an actionable problem and its row.
	 *
	 * @dataProvider invalid_files
	 *
	 * @param string   $contents File contents.
	 * @param string   $code     Expected problem code.
	 * @param int|null $row      Expected row, when the problem is in one row.
	 */
	public function test_invalid_file_is_refused( $contents, $code, $row ) {
		$errors = $this->errors_for( $contents );

		$this->assertSame( $code, $errors[0]['code'] );
		$this->assertSame( $row, $errors[0]['row'] );
		$this->assertNotSame( '', $errors[0]['message'] );
	}

	/** A file over the size limit is refused before it is read. */
	public function test_oversized_file_is_refused() {
		$errors = $this->errors_for( str_repeat( 'a', CsvParser::MAX_BYTES + 1 ) );

		$this->assertSame( 'csv_too_large', $errors[0]['code'] );
	}

	/** Every bad row is reported, up to the limit, instead of only the first. */
	public function test_reports_several_problems_at_once() {
		$rows = '';
		for ( $i = 0; $i < 30; $i++ ) {
			$rows .= ",ideal,EUR,bad,paid,tr_many00000$i,Ticket,EUR,10.00,REF.1\n";
		}

		$errors = $this->errors_for( self::HEADER . "\n" . $rows );

		$this->assertCount( CsvParser::MAX_ERRORS, $errors );
		$this->assertSame( 2, $errors[0]['row'] );
		$this->assertSame( 3, $errors[1]['row'] );
	}
}
