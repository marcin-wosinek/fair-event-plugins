<?php
/**
 * Meta outbox enqueue tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\Outbox;
use PHPUnit\Framework\TestCase;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.FunctionComment.MissingParamTag

/** Covers how the event context snapshot is written to the outbox. */
class OutboxTest extends TestCase {
	/** @var mixed Original $wpdb. */
	private $original_wpdb;

	/** Install a $wpdb fake that records prepared statements. */
	protected function setUp(): void {
		parent::setUp();
		$this->original_wpdb = $GLOBALS['wpdb'] ?? null;
		$GLOBALS['wpdb']     = new class() { // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- test fake, restored in tearDown().
			/** @var string */
			public $prefix = 'wp_';
			/** @var array[] */
			public $prepared = array();

			/**
			 * @param string $query   Query.
			 * @param mixed  ...$args Arguments.
			 * @return array
			 */
			public function prepare( $query, ...$args ) {
				$this->prepared[] = array( $query, $args );
				return array( $query, $args );
			}

			/**
			 * @param mixed $query Prepared query.
			 * @return int
			 */
			public function query( $query ) {
				unset( $query );
				return 1;
			}
		};
	}

	/** Restore $wpdb. */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->original_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- restores the original.
		parent::tearDown();
	}

	/**
	 * A commerce outbox event.
	 *
	 * @param array $overrides Fields to override.
	 * @return array
	 */
	private function event( array $overrides = array() ) {
		return array_merge(
			array(
				'transaction_id' => 42,
				'event_name'     => 'Purchase',
				'event_id'       => 'stable',
				'event_time'     => 123,
				'source_url'     => 'https://example.test/event',
				'value'          => 12.5,
				'currency'       => 'EUR',
				'order_id'       => '42',
				'payment_mode'   => 'live',
				'fbp'            => 'fb.1.1712345678901.browser',
				'fbc'            => '',
			),
			$overrides
		);
	}

	/**
	 * The bound value of a column in the last INSERT.
	 *
	 * @param string $column Column name.
	 * @return array [ placeholder, value ]
	 */
	private function bound( $column ) {
		list( $query, $args ) = end( $GLOBALS['wpdb']->prepared );
		preg_match( '/\(([^)]*)\) VALUES \((.*)\)$/', $query, $parts );
		$columns      = explode( ',', $parts[1] );
		$placeholders = preg_split( '/,(?![^(]*\))/', $parts[2] );
		$index        = array_search( $column, $columns, true );
		// The table name is the first argument.
		return array( $placeholders[ $index ], $args[ $index + 1 ] );
	}

	/** The context snapshot is stored as given. */
	public function test_enqueue_stores_the_context_snapshot() {
		$json = '{"content_ids":["12"],"event_date_id":30}';
		$this->assertTrue( ( new Outbox() )->enqueue( $this->event( array( 'event_context' => $json ) ) ) );
		$this->assertSame( array( "NULLIF(%s,'')", $json ), $this->bound( 'event_context' ) );
	}

	/** An event without context, or with an empty one, stores NULL. */
	public function test_enqueue_without_context_stores_null() {
		( new Outbox() )->enqueue( $this->event() );
		$this->assertSame( array( "NULLIF(%s,'')", '' ), $this->bound( 'event_context' ) );
		( new Outbox() )->enqueue( $this->event( array( 'event_context' => '' ) ) );
		$this->assertSame( array( "NULLIF(%s,'')", '' ), $this->bound( 'event_context' ) );
	}

	/** Placeholders and bound values stay aligned. */
	public function test_enqueue_binds_every_column() {
		( new Outbox() )->enqueue( $this->event() );
		list( $query, $args ) = end( $GLOBALS['wpdb']->prepared );
		$this->assertSame( substr_count( $query, '%' ), count( $args ) );
		$this->assertSame( array( '%s', 'fb.1.1712345678901.browser' ), $this->bound( 'fbp' ) );
		$this->assertSame( array( '%s', 'pending' ), $this->bound( 'state' ) );
	}
}
