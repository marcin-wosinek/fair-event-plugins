<?php
/**
 * AudienceCsv tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use FairAudience\Services\AudienceCsv;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * CSV parsing, serialization and reversible formula protection (#2218).
 */
class AudienceCsvTest extends TestCase {

	/**
	 * Values that must survive escape and unescape unchanged.
	 *
	 * @return array<string, array{string}>
	 */
	public static function round_trip_values(): array {
		return array(
			'plain'                  => array( 'Ana' ),
			'empty'                  => array( '' ),
			'formula'                => array( '=HYPERLINK("http://x")' ),
			'international phone'    => array( '+34 600 000 000' ),
			'leading minus'          => array( '-5' ),
			'at sign'                => array( '@handle' ),
			'leading apostrophe'     => array( "'Ana" ),
			'escaped-looking value'  => array( "'=1" ),
			'lone apostrophe'        => array( "'" ),
			'inner apostrophe'       => array( "O'Neil" ),
			'unicode'                => array( 'Zoë Ñúñez 李' ),
			'comma and quote'        => array( 'Smith, "Jr"' ),
			'line break'             => array( "two\nlines" ),
			'surrounding whitespace' => array( ' padded ' ),
		);
	}

	/**
	 * Escaping is reversible for every value.
	 *
	 * @param string $value Raw value.
	 */
	#[DataProvider( 'round_trip_values' )]
	public function test_escape_round_trip( string $value ) {
		$this->assertSame( $value, AudienceCsv::unescape_cell( AudienceCsv::escape_cell( $value ) ) );
	}

	/**
	 * Values a spreadsheet would run as formulas start with an apostrophe.
	 */
	public function test_escape_protects_formula_prefixes() {
		foreach ( array( '=1+1', '+1', '-1', '@SUM(A1)', "\tx", "\rx" ) as $value ) {
			$this->assertSame( "'" . $value, AudienceCsv::escape_cell( $value ) );
		}
		$this->assertSame( 'Ana', AudienceCsv::escape_cell( 'Ana' ) );
	}

	/**
	 * A hand-written apostrophe that protects nothing is kept, and a value a
	 * spreadsheet saved without its protecting apostrophe reads unchanged.
	 */
	public function test_unescape_keeps_unprotected_values() {
		$this->assertSame( "'Ana", AudienceCsv::unescape_cell( "'Ana" ) );
		$this->assertSame( '+34 600', AudienceCsv::unescape_cell( '+34 600' ) );
		$this->assertSame( '+34 600', AudienceCsv::unescape_cell( "'+34 600" ) );
	}

	/**
	 * Every value survives a whole-file serialize and parse.
	 */
	public function test_file_round_trip() {
		$values = array_column( self::round_trip_values(), 0 );
		$rows   = array_map(
			static function ( $value ) {
				return array( $value, 'x' );
			},
			$values
		);

		$parsed = AudienceCsv::parse( AudienceCsv::serialize( array( 'a', 'b' ), $rows ) );

		$this->assertNull( $parsed['error'] );
		$records = array_values( $parsed['records'] );
		$this->assertSame( array( 'a', 'b' ), array_shift( $records ) );
		$this->assertSame(
			$values,
			array_map(
				static function ( $record ) {
					return AudienceCsv::unescape_cell( $record[0] );
				},
				$records
			)
		);
	}

	/**
	 * Output starts with a byte order mark and uses CRLF line endings.
	 */
	public function test_serialize_writes_bom_and_crlf() {
		$this->assertSame( AudienceCsv::BOM . "a,b\r\n1,\"x,y\"\r\n", AudienceCsv::serialize( array( 'a', 'b' ), array( array( '1', 'x,y' ) ) ) );
	}

	/**
	 * Records are keyed by the line they start on; blank lines are skipped,
	 * and LF, CRLF and a missing final line break are all accepted.
	 */
	public function test_parse_line_numbers_and_line_endings() {
		$parsed = AudienceCsv::parse( "a,b\n\n\"multi\nline\",2\r\nlast,3" );

		$this->assertNull( $parsed['error'] );
		$this->assertSame(
			array(
				1 => array( 'a', 'b' ),
				3 => array( "multi\nline", '2' ),
				5 => array( 'last', '3' ),
			),
			$parsed['records']
		);
	}

	/**
	 * A byte order mark is optional.
	 */
	public function test_parse_accepts_bom() {
		$this->assertSame( array( 1 => array( 'a' ) ), AudienceCsv::parse( AudienceCsv::BOM . "a\n" )['records'] );
		$this->assertSame( array( 1 => array( 'a' ) ), AudienceCsv::parse( "a\n" )['records'] );
	}

	/**
	 * Broken quoting is reported with its line.
	 *
	 * @return array<string, array{string, int}>
	 */
	public static function malformed_files(): array {
		return array(
			'unterminated quote'      => array( "a\n\"open,1\n2,3\n", 2 ),
			'text after closing'      => array( "a,b\n\"x\"y,1\n", 2 ),
			'quote inside bare field' => array( "a,b\nx\"y,1\n", 2 ),
		);
	}

	/**
	 * Malformed CSV is rejected.
	 *
	 * @param string $text CSV text.
	 * @param int    $line Line the problem is on.
	 */
	#[DataProvider( 'malformed_files' )]
	public function test_parse_rejects_malformed( string $text, int $line ) {
		$parsed = AudienceCsv::parse( $text );

		$this->assertSame( 'malformed', $parsed['error'] );
		$this->assertSame( $line, $parsed['line'] );
		$this->assertSame( array(), $parsed['records'] );
	}

	/**
	 * Text that is not UTF-8 is rejected.
	 */
	public function test_parse_rejects_invalid_utf8() {
		$this->assertSame( 'encoding', AudienceCsv::parse( "name\n\xE9t\xE9\n" )['error'] );
	}
}
