<?php
/**
 * Outgoing Meta request snapshot tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\RequestDiagnostics;
use PHPUnit\Framework\TestCase;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/** Covers redaction, structure and bounds of request snapshots. */
class RequestDiagnosticsTest extends TestCase {
	private const TOKEN      = 'EAAsecret-access-token';
	private const TEST_CODE  = 'TEST98765';
	private const FBP        = 'fb.1.1712345678901.browser';
	private const USER_AGENT = 'Mozilla/5.0 SnapshotTest';
	private const EVENT_ID   = '9f86d081884c7d659a2feb1e7f0e7f2a6c2a7b0b3c8f6a6e3e5b8c9d0a1b2c3d';

	/** @return array A production-like request body. */
	private function body() {
		return array(
			'data'            => array(
				array(
					'event_name'       => 'Purchase',
					'event_time'       => 1712345678,
					'event_id'         => self::EVENT_ID,
					'action_source'    => 'website',
					'event_source_url' => 'https://example.test/events/secret-slug/?utm_source=x&ref=y#top',
					'user_data'        => array(
						'fbp'               => self::FBP,
						'fbc'               => 'not-an-identifier',
						'client_user_agent' => self::USER_AGENT,
						'external_id'       => array( hash( 'sha256', 'someone' ) ),
						'em'                => 'person@example.test',
					),
					'custom_data'      => array(
						'value'            => 12.5,
						'currency'         => 'EUR',
						'payment_mode'     => 'test',
						'order_id'         => '4242',
						'content_name'     => 'Spring Social',
						'content_ids'      => array( '12', 'event-date:30' ),
						'event_start_date' => '2026-05-01',
						'empty_note'       => '',
						'nothing'          => null,
						'tags'             => array(),
						'mystery'          => 7,
					),
				),
			),
			'access_token'    => self::TOKEN,
			'test_event_code' => self::TEST_CODE,
		);
	}

	/** @param array $snapshot Snapshot. @return array Fields by path. */
	private function fields( $snapshot ) {
		return array_column( $snapshot['fields'], null, 'path' );
	}

	/** Destination, method and Test Events routing are recorded. */
	public function test_records_the_destination() {
		$snapshot = RequestDiagnostics::capture( $this->body(), '1234567890', 'v26.0' );
		$this->assertSame( 1, $snapshot['version'] );
		$this->assertSame( 'POST', $snapshot['method'] );
		$this->assertSame( 'application/json', $snapshot['content_type'] );
		$this->assertSame( 'v26.0', $snapshot['api_version'] );
		$this->assertSame( '1234567890', $snapshot['dataset_id'] );
		$this->assertTrue( $snapshot['test_events_code'] );
		$this->assertFalse( $snapshot['truncated'] );

		$body = $this->body();
		unset( $body['test_event_code'] );
		$this->assertFalse( RequestDiagnostics::capture( $body, '1234567890', 'v26.0' )['test_events_code'] );
	}

	/** Credentials and personal identifiers never reach the snapshot. */
	public function test_redacts_credentials_and_identifiers() {
		$json = wp_json_encode( RequestDiagnostics::capture( $this->body(), '1234567890', 'v26.0' ) );
		foreach ( array( self::TOKEN, self::TEST_CODE, self::FBP, self::USER_AGENT, self::EVENT_ID, hash( 'sha256', 'someone' ), 'person@example.test', '4242', 'secret-slug', 'utm_source', '#top' ) as $secret ) {
			$this->assertStringNotContainsString( $secret, $json );
		}
	}

	/** Allowlisted values are kept with their original types. */
	public function test_keeps_safe_values() {
		$fields = $this->fields( RequestDiagnostics::capture( $this->body(), '1234567890', 'v26.0' ) );
		$this->assertSame(
			array(
				'path'  => 'data[0].event_name',
				'type'  => 'string',
				'state' => 'value',
				'value' => 'Purchase',
			),
			$fields['data[0].event_name']
		);
		$this->assertSame( 1712345678, $fields['data[0].event_time']['value'] );
		$this->assertSame( 12.5, $fields['data[0].custom_data.value']['value'] );
		$this->assertSame( 'number', $fields['data[0].custom_data.value']['type'] );
		$this->assertSame( 'EUR', $fields['data[0].custom_data.currency']['value'] );
		$this->assertSame( 'test', $fields['data[0].custom_data.payment_mode']['value'] );
		$this->assertSame( 'Spring Social', $fields['data[0].custom_data.content_name']['value'] );
		$this->assertSame( 'event-date:30', $fields['data[0].custom_data.content_ids[1]']['value'] );
		$this->assertSame( 'website', $fields['data[0].action_source']['value'] );
	}

	/** Absent, null, empty and redacted values stay distinguishable. */
	public function test_distinguishes_missing_null_empty_and_redacted() {
		$fields = $this->fields( RequestDiagnostics::capture( $this->body(), '1234567890', 'v26.0' ) );
		$this->assertSame( 'empty', $fields['data[0].custom_data.empty_note']['state'] );
		$this->assertSame( 'null', $fields['data[0].custom_data.nothing']['state'] );
		$this->assertSame(
			array(
				'path'  => 'data[0].custom_data.tags',
				'type'  => 'array',
				'count' => 0,
				'state' => 'empty',
			),
			$fields['data[0].custom_data.tags']
		);
		$this->assertSame( 'redacted', $fields['data[0].custom_data.order_id']['state'] );
		$this->assertSame( 4, $fields['data[0].custom_data.order_id']['length'] );
		$this->assertArrayNotHasKey( 'data[0].custom_data.missing', $fields );
		$this->assertSame(
			array(
				'path'  => 'data[0].user_data',
				'type'  => 'object',
				'count' => 5,
				'state' => 'structure',
			),
			$fields['data[0].user_data']
		);
	}

	/** Recognized identifiers report validation results instead of values. */
	public function test_reports_identifier_validation() {
		$fields = $this->fields( RequestDiagnostics::capture( $this->body(), '1234567890', 'v26.0' ) );
		$this->assertSame( 'valid', $fields['data[0].user_data.fbp']['check'] );
		$this->assertSame( 'invalid', $fields['data[0].user_data.fbc']['check'] );
		$this->assertSame( 'sha256', $fields['data[0].user_data.external_id[0]']['check'] );
		$this->assertSame( 'not_sha256', $fields['data[0].user_data.em']['check'] );
		$this->assertSame( 'sha256', $fields['data[0].event_id']['check'] );
		$this->assertArrayNotHasKey( 'check', $fields['data[0].user_data.client_user_agent'] );
		$this->assertSame( 'redacted', $fields['access_token']['state'] );
		$this->assertSame( 'redacted', $fields['test_event_code']['state'] );
	}

	/** Only the structure of the source URL is kept. */
	public function test_keeps_source_url_structure() {
		$field = $this->fields( RequestDiagnostics::capture( $this->body(), '1234567890', 'v26.0' ) )['data[0].event_source_url'];
		$this->assertSame( 'redacted', $field['state'] );
		$this->assertSame(
			array(
				'origin'    => 'https://example.test',
				'same_site' => true,
				'path'      => true,
				'query'     => 2,
				'fragment'  => true,
			),
			$field['url']
		);
	}

	/** Unknown fields keep their type, but not their value. */
	public function test_redacts_unknown_fields() {
		$fields = $this->fields( RequestDiagnostics::capture( $this->body(), '1234567890', 'v26.0' ) );
		$this->assertSame(
			array(
				'path'  => 'data[0].custom_data.mystery',
				'type'  => 'integer',
				'state' => 'redacted',
			),
			$fields['data[0].custom_data.mystery']
		);
	}

	/** An allowlisted field whose value fails its rule is redacted. */
	public function test_redacts_invalid_allowlisted_values() {
		$body                                       = $this->body();
		$body['data'][0]['custom_data']['currency'] = 'not a currency';
		$body['data'][0]['custom_data']['content_name'] = 'Contact ' . self::FBP;
		$fields = $this->fields( RequestDiagnostics::capture( $body, '1234567890', 'v26.0' ) );
		$this->assertSame( 'redacted', $fields['data[0].custom_data.currency']['state'] );
		$this->assertSame( 'redacted', $fields['data[0].custom_data.content_name']['state'] );
	}

	/** Snapshots stay within their field, string, depth and size limits. */
	public function test_bounds_the_snapshot() {
		$body = $this->body();
		$body['data'][0]['custom_data']['content_name'] = str_repeat( 'a', 500 );
		$fields = $this->fields( RequestDiagnostics::capture( $body, '1234567890', 'v26.0' ) );
		$this->assertSame( RequestDiagnostics::MAX_STRING, strlen( $fields['data[0].custom_data.content_name']['value'] ) );
		$this->assertTrue( $fields['data[0].custom_data.content_name']['truncated'] );

		$body['data'][0]['custom_data']['many'] = array_fill( 0, 1000, str_repeat( 'x', 100 ) );
		$snapshot                               = RequestDiagnostics::capture( $body, '1234567890', 'v26.0' );
		$this->assertTrue( $snapshot['truncated'] );
		$this->assertLessThanOrEqual( RequestDiagnostics::MAX_FIELDS, count( $snapshot['fields'] ) );
		$this->assertLessThanOrEqual( RequestDiagnostics::MAX_BYTES, strlen( wp_json_encode( $snapshot ) ) );

		$deep = 'leaf';
		for ( $i = 0; $i < 20; $i++ ) {
			$deep = array( 'level' => $deep );
		}
		$fields = RequestDiagnostics::capture( array( 'data' => array( $deep ) ), '1', 'v26.0' )['fields'];
		$this->assertLessThanOrEqual( RequestDiagnostics::MAX_DEPTH + 2, count( $fields ) );
		$this->assertTrue( end( $fields )['truncated'] );
	}

	/** Every redacted value of a body is offered for redaction from Meta's messages. */
	public function test_secrets_cover_redacted_values() {
		$secrets = RequestDiagnostics::secrets( $this->body() );
		foreach ( array( self::TOKEN, self::TEST_CODE, self::FBP, self::USER_AGENT, self::EVENT_ID, '4242' ) as $secret ) {
			$this->assertContains( $secret, $secrets );
		}
		$this->assertNotContains( 'Purchase', $secrets );
		$this->assertNotContains( 'Spring Social', $secrets );
	}

	/** Stored snapshots are re-validated before they are returned. */
	public function test_from_storage_keeps_only_known_keys() {
		$snapshot                       = RequestDiagnostics::capture( $this->body(), '1234567890', 'v26.0' );
		$snapshot['extra']              = 'nope';
		$snapshot['fields'][0]['extra'] = 'nope';
		$snapshot['fields'][]           = array(
			'path'  => 'x',
			'type'  => 'weird',
			'state' => 'value',
		);
		$stored                         = RequestDiagnostics::from_storage( json_decode( wp_json_encode( $snapshot ), true ) );
		$this->assertStringNotContainsString( 'nope', wp_json_encode( $stored ) );
		$this->assertCount( count( $snapshot['fields'] ) - 1, $stored['fields'] );
		$this->assertSame( 12.5, $this->fields( $stored )['data[0].custom_data.value']['value'] );
		$this->assertNull( RequestDiagnostics::from_storage( array( 'version' => 99 ) ) );
		$this->assertNull( RequestDiagnostics::from_storage( 'garbage' ) );
	}
}
