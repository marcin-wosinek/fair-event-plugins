<?php
/**
 * AudienceMigration tests
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services;

use FairAudience\Models\Participant;
use FairAudience\Services\AudienceCsv;
use FairAudience\Services\AudienceMigration;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Normalization, comparison and import decisions of the audience CSV
 * migration (#2218), against an in-memory destination.
 */
class AudienceMigrationTest extends TestCase {

	/**
	 * Destination members keyed by normalized email.
	 *
	 * @var array<string, array>
	 */
	private $members = array();

	/**
	 * Values passed to insert, in order.
	 *
	 * @var array<int, array>
	 */
	private $inserted = array();

	/**
	 * Importer writing to the in-memory destination.
	 *
	 * @param bool $insert_fails Whether every insert fails.
	 * @return AudienceMigration
	 */
	private function importer( bool $insert_fails = false ): AudienceMigration {
		return new AudienceMigration(
			function ( $email ) {
				return $this->members[ $email ] ?? null;
			},
			function ( $values ) use ( $insert_fails ) {
				if ( $insert_fails ) {
					return false;
				}
				$this->inserted[]                  = $values;
				$this->members[ $values['email'] ] = $values;
				return true;
			}
		);
	}

	/**
	 * A CSV file with the standard header.
	 *
	 * @param string[] $lines Data lines.
	 * @param string   $header Header line.
	 * @return string
	 */
	private static function file( array $lines, string $header = 'format_version,name,surname,email,phone,instagram,email_profile,weekly_summary_opt_out' ): string {
		return $header . "\n" . implode( "\n", $lines ) . "\n";
	}

	/**
	 * A destination member.
	 *
	 * @param array $overrides Field overrides.
	 * @return array
	 */
	private static function member( array $overrides = array() ): array {
		return array_merge(
			array(
				'name'                   => 'Ana',
				'surname'                => 'Ruiz',
				'phone'                  => '+34 600',
				'instagram'              => 'ana',
				'email_profile'          => 'marketing',
				'weekly_summary_opt_out' => false,
			),
			$overrides
		);
	}

	/**
	 * An export of real participants imports into an empty site unchanged,
	 * Unicode, quoting and formula-looking values included.
	 */
	public function test_export_import_round_trip() {
		$participants = array(
			new Participant(
				array(
					'name'                   => 'Zoë',
					'surname'                => "O'Neil, \"Jr\"",
					'email'                  => 'zoe@example.org',
					'phone'                  => '+34 600 000 000',
					'instagram'              => '@zoe',
					'email_profile'          => 'marketing',
					'weekly_summary_opt_out' => 1,
					'weekly_feed_mode'       => 'all',
					'status'                 => 'confirmed',
				)
			),
			new Participant(
				array(
					'name'          => '=cmd',
					'email'         => 'cmd@example.org',
					'email_profile' => 'declined',
				)
			),
		);

		$csv = AudienceMigration::export_csv( $participants );
		$this->assertStringNotContainsString( 'confirmed', $csv );
		$this->assertStringNotContainsString( ',all', $csv );
		$this->assertStringContainsString( "'+34 600 000 000", $csv );
		$this->assertStringContainsString( "'=cmd", $csv );

		$outcome = $this->importer()->import( $csv );

		$this->assertNull( $outcome['error'] );
		$this->assertCount( 2, $outcome['result']['imported'] );
		$this->assertSame(
			array(
				'name'                   => 'Zoë',
				'surname'                => "O'Neil, \"Jr\"",
				'phone'                  => '+34 600 000 000',
				'instagram'              => '@zoe',
				'email'                  => 'zoe@example.org',
				'email_profile'          => 'marketing',
				'weekly_summary_opt_out' => true,
			),
			$this->inserted[0]
		);
		$this->assertSame( '=cmd', $this->inserted[1]['name'] );
		$this->assertFalse( $this->inserted[1]['weekly_summary_opt_out'] );
	}

	/**
	 * An empty export, such as a subscriber-only export with no subscribers,
	 * is the header row alone. Importing it is refused as having no members
	 * and writes nothing.
	 */
	public function test_empty_export_is_header_only() {
		$csv = AudienceMigration::export_csv( array() );

		$this->assertSame( 1, substr_count( $csv, "\r\n" ) );
		$this->assertStringContainsString( 'format_version,name,surname,email', $csv );

		$outcome = $this->importer()->import( $csv );

		$this->assertSame( 'empty_file', $outcome['error']['code'] );
		$this->assertSame( 'The file has no audience members.', $outcome['error']['message'] );
		$this->assertSame( array(), $this->inserted );
	}

	/**
	 * Importing the same file twice creates nothing the second time.
	 */
	public function test_reimport_is_already_present() {
		$csv = self::file( array( '1,Ana,Ruiz,ana@example.com,,,minimal,0' ) );
		$this->importer()->import( $csv );

		$second = $this->importer()->import( $csv )['result'];

		$this->assertCount( 1, $this->inserted );
		$this->assertSame( array(), $second['imported'] );
		$this->assertSame( array( 2 ), array_column( $second['already_present'], 'line' ) );
	}

	/**
	 * A repeated row in one file is inserted once.
	 */
	public function test_repeated_rows_insert_once() {
		$result = $this->importer()->import(
			self::file(
				array(
					'1,Ana,Ruiz,ana@example.com,,,minimal,0',
					'1,Ana,Ruiz,ANA@example.com ,,,minimal,0',
					'1,Ana,Other,ana@example.com,,,minimal,0',
				)
			)
		)['result'];

		$this->assertCount( 1, $this->inserted );
		$this->assertSame( array( 3 ), array_column( $result['already_present'], 'line' ) );
		$this->assertSame( array( 'surname' ), $result['conflicts'][0]['fields'] );
	}

	/**
	 * Email matching trims and ignores case; contact fields keep their case.
	 */
	public function test_matching_normalizes_email_only() {
		$this->members['ana@example.com'] = self::member();

		$result = $this->importer()->import(
			self::file(
				array(
					"1, Ana , Ruiz , Ana@Example.COM ,'+34 600,ana,Marketing,0",
					'1,ana,Ruiz,ana@example.com,+34 600,ana,marketing,0',
				)
			)
		)['result'];

		$this->assertSame( array( 2 ), array_column( $result['already_present'], 'line' ) );
		$this->assertSame( array( 'name' ), $result['conflicts'][0]['fields'] );
		$this->assertSame( array(), $this->inserted );
	}

	/**
	 * Opt-out disagreements in each direction.
	 *
	 * @return array<string, array>
	 */
	public static function opt_out_conflicts(): array {
		return array(
			'file opts out of weekly, member does not'  => array( array(), 'marketing,1', array( 'weekly_summary_opt_out' ), array( 'weekly_summary_opt_out' ) ),
			'member opts out of weekly, file does not'  => array( array( 'weekly_summary_opt_out' => true ), 'marketing,0', array( 'weekly_summary_opt_out' ), array() ),
			'file has no marketing consent, member has' => array( array(), 'minimal,0', array( 'email_profile' ), array( 'email_profile' ) ),
			'member declined, file has marketing'       => array( array( 'email_profile' => 'declined' ), 'marketing,0', array( 'email_profile' ), array() ),
		);
	}

	/**
	 * Every opt-out disagreement is a conflict that changes nothing; the
	 * ones where the file is stricter are flagged as not transferred.
	 *
	 * @param array    $member    Destination overrides.
	 * @param string   $tail      email_profile and weekly_summary_opt_out cells.
	 * @param string[] $fields    Expected differing fields.
	 * @param string[] $opt_outs  Expected untransferred opt-outs.
	 */
	#[DataProvider( 'opt_out_conflicts' )]
	public function test_opt_out_conflicts( array $member, string $tail, array $fields, array $opt_outs ) {
		$this->members['ana@example.com'] = self::member( $member );
		$before                           = $this->members;

		$result = $this->importer()->import( self::file( array( "1,Ana,Ruiz,ana@example.com,'+34 600,ana," . $tail ) ) )['result'];

		$this->assertSame( $fields, $result['conflicts'][0]['fields'] );
		$this->assertSame( $opt_outs, $result['conflicts'][0]['untransferred_opt_out'] );
		$this->assertSame( $before, $this->members );
		$this->assertSame( array(), $this->inserted );
	}

	/**
	 * Legacy feed modes are accepted, never compared, and create no
	 * subscriptions nor marketing consent.
	 */
	public function test_legacy_feed_mode_is_ignored() {
		$this->members['ana@example.com'] = self::member();

		$result = $this->importer()->import(
			self::file(
				array(
					"1,Ana,Ruiz,ana@example.com,'+34 600,ana,marketing,0,all",
					'1,Bo,Li,bo@example.com,,,minimal,0,all',
					'1,Cy,Li,cy@example.com,,,minimal,1,selected',
					'1,Di,Li,di@example.com,,,declined,0,',
				),
				'format_version,name,surname,email,phone,instagram,email_profile,weekly_summary_opt_out,weekly_feed_mode'
			)
		)['result'];

		$this->assertSame( array( 2 ), array_column( $result['already_present'], 'line' ) );
		$this->assertSame( array( 'minimal', 'minimal', 'declined' ), array_column( $this->inserted, 'email_profile' ) );
		foreach ( $this->inserted as $values ) {
			$this->assertArrayNotHasKey( 'weekly_feed_mode', $values );
			$this->assertArrayNotHasKey( 'feed_ids', $values );
		}
	}

	/**
	 * Rows without email are skipped and reported, never inserted.
	 */
	public function test_missing_email_is_skipped() {
		$result = $this->importer()->import( self::file( array( '1,Li,Wei,,,,minimal,0', '1,Li,Wei,  ,,,minimal,0' ) ) )['result'];

		$this->assertSame( array( 2, 3 ), array_column( $result['missing_email'], 'line' ) );
		$this->assertSame( array(), $this->inserted );
	}

	/**
	 * Invalid values in a row.
	 *
	 * @return array<string, array{string, string}>
	 */
	public static function invalid_rows(): array {
		return array(
			'no name'         => array( '1,,Ruiz,a@example.com,,,minimal,0', 'name' ),
			'bad email'       => array( '1,Ana,Ruiz,not-an-email,,,minimal,0', 'email' ),
			'unknown profile' => array( '1,Ana,Ruiz,a@example.com,,,subscribed,0', 'email_profile' ),
			'empty boolean'   => array( '1,Ana,Ruiz,a@example.com,,,minimal,', 'weekly_summary_opt_out' ),
			'other boolean'   => array( '1,Ana,Ruiz,a@example.com,,,minimal,2', 'weekly_summary_opt_out' ),
			'tags'            => array( '1,<b>Ana</b>,Ruiz,a@example.com,,,minimal,0', 'name' ),
			'phone too long'  => array( '1,Ana,Ruiz,a@example.com,' . str_repeat( '1', 51 ) . ',,minimal,0', 'phone' ),
		);
	}

	/**
	 * Invalid values are reported per field and never repaired or inserted.
	 *
	 * @param string $line  Data line.
	 * @param string $field Field expected to be reported.
	 */
	#[DataProvider( 'invalid_rows' )]
	public function test_invalid_rows_are_reported( string $line, string $field ) {
		$result = $this->importer()->import( self::file( array( $line ) ) )['result'];

		$this->assertSame( array( $field ), array_column( $result['invalid'][0]['errors'], 'field' ) );
		$this->assertSame( array(), $this->inserted );
	}

	/**
	 * Boolean spellings.
	 */
	public function test_boolean_spellings() {
		foreach ( array( 'yes', 'TRUE', '1' ) as $value ) {
			$this->assertTrue(
				AudienceMigration::normalize_row(
					array(
						'name'                   => 'A',
						'email'                  => 'a@example.com',
						'email_profile'          => 'minimal',
						'weekly_summary_opt_out' => $value,
					)
				)['values']['weekly_summary_opt_out']
			);
		}
		foreach ( array( 'no', 'False', '0' ) as $value ) {
			$this->assertFalse(
				AudienceMigration::normalize_row(
					array(
						'name'                   => 'A',
						'email'                  => 'a@example.com',
						'email_profile'          => 'minimal',
						'weekly_summary_opt_out' => $value,
					)
				)['values']['weekly_summary_opt_out']
			);
		}
	}

	/**
	 * A failed insert whose address still does not exist is a failure; one
	 * that lost a race to another request is compared instead.
	 */
	public function test_failed_inserts() {
		$result = $this->importer( true )->import( self::file( array( '1,Ana,Ruiz,ana@example.com,,,minimal,0' ) ) )['result'];
		$this->assertSame( array( 2 ), array_column( $result['failed'], 'line' ) );

		$lookups  = 0;
		$importer = new AudienceMigration(
			static function () use ( &$lookups ) {
				return 1 === ++$lookups ? null : self::member( array( 'phone' => '' ) );
			},
			static function () {
				return false;
			}
		);
		$result   = $importer->import( self::file( array( '1,Ana,Ruiz,ana@example.com,,ana,marketing,0' ) ) )['result'];
		$this->assertSame( array( 2 ), array_column( $result['already_present'], 'line' ) );
		$this->assertSame( array(), $result['failed'] );
	}

	/**
	 * Files rejected before any row is processed.
	 *
	 * @return array<string, array{string, string}>
	 */
	public static function rejected_files(): array {
		$header = 'format_version,name,surname,email,phone,instagram,email_profile,weekly_summary_opt_out';
		return array(
			'empty'              => array( '', 'empty_file' ),
			'header only'        => array( $header . "\n", 'empty_file' ),
			'missing column'     => array( "format_version,name,email\n1,Ana,a@example.com\n", 'missing_columns' ),
			'unsupported column' => array( $header . ",feeds\n1,Ana,,a@example.com,,,minimal,0,3\n", 'unsupported_columns' ),
			'duplicate column'   => array( $header . ",name\n1,Ana,,a@example.com,,,minimal,0,Ana\n", 'duplicate_columns' ),
			'short row'          => array( $header . "\n1,Ana,,a@example.com,,,minimal\n", 'malformed_csv' ),
			'broken quotes'      => array( $header . "\n1,\"Ana,,a@example.com,,,minimal,0\n", 'malformed_csv' ),
			'other version'      => array( $header . "\n2,Ana,,a@example.com,,,minimal,0\n", 'unsupported_version' ),
			'not utf-8'          => array( $header . "\n1,Ren\xE9,,a@example.com,,,minimal,0\n", 'invalid_encoding' ),
		);
	}

	/**
	 * Structural problems reject the whole file without writing, even when
	 * earlier rows are valid.
	 *
	 * @param string $text File contents.
	 * @param string $code Expected error code.
	 */
	#[DataProvider( 'rejected_files' )]
	public function test_structural_errors_reject_the_file( string $text, string $code ) {
		$valid   = "1,Bo,Li,bo@example.com,,,minimal,0\n";
		$parts   = explode( "\n", $text, 2 );
		$text    = count( $parts ) === 2 && '' !== $parts[1] ? $parts[0] . "\n" . $valid . $parts[1] : $text;
		$outcome = $this->importer()->import( $text );

		$this->assertSame( $code, $outcome['error']['code'] );
		$this->assertNull( $outcome['result'] );
		$this->assertSame( array(), $this->inserted );
	}

	/**
	 * Size and row limits.
	 */
	public function test_limits() {
		$this->assertSame( 'file_too_large', AudienceMigration::read( str_repeat( 'a', AudienceMigration::MAX_BYTES + 1 ) )['error']['code'] );

		$rows = array_fill( 0, AudienceMigration::MAX_ROWS + 1, '1,A,,,,,minimal,0' );
		$this->assertSame( 'too_many_rows', AudienceMigration::read( self::file( $rows ) )['error']['code'] );

		$rows = array_fill( 0, AudienceMigration::MAX_ROWS, '1,A,,,,,minimal,0' );
		$this->assertNull( AudienceMigration::read( self::file( $rows ) )['error'] );
	}

	/**
	 * Header names are trimmed and case-insensitive, and the optional byte
	 * order mark is accepted.
	 */
	public function test_header_normalization() {
		$read = AudienceMigration::read( AudienceCsv::BOM . " Format_Version ,NAME,surname,email,phone,instagram,email_profile,weekly_summary_opt_out\r\n1,Ana,,a@example.com,,,minimal,0\r\n" );

		$this->assertNull( $read['error'] );
		$this->assertSame( 'Ana', $read['rows'][2]['name'] );
	}
}
