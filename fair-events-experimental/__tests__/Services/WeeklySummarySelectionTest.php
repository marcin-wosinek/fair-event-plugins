<?php
/**
 * Tests for WeeklySummarySelection.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Services;

use FairEventsExperimental\Services\WeeklySummarySelection;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Finding the Events Week block an operator link names.
 */
class WeeklySummarySelectionTest extends TestCase {

	/**
	 * A parsed Events Week block.
	 *
	 * @param array $attrs Block attributes.
	 * @return array
	 */
	private static function week( array $attrs ) {
		return array(
			'blockName'   => 'fair-events/events-week',
			'attrs'       => $attrs,
			'innerBlocks' => array(),
		);
	}

	/**
	 * A parsed container block.
	 *
	 * @param array[] $inner Inner blocks.
	 * @return array
	 */
	private static function group( array $inner ) {
		return array(
			'blockName'   => 'core/group',
			'attrs'       => array(),
			'innerBlocks' => $inner,
		);
	}

	/**
	 * A parsed synced pattern reference.
	 *
	 * @param int $ref Pattern ID.
	 * @return array
	 */
	private static function synced( $ref ) {
		return array(
			'blockName'   => 'core/block',
			'attrs'       => array( 'ref' => $ref ),
			'innerBlocks' => array(),
		);
	}

	/**
	 * Resolver for pages without synced patterns.
	 *
	 * @return callable
	 */
	private static function no_patterns() {
		return static fn() => null;
	}

	/**
	 * Each anchor resolves to its own calendar's selection.
	 */
	public function test_three_communities_on_one_page_resolve_independently() {
		$blocks = array(
			self::week(
				array(
					'anchor'     => 'valencia',
					'categories' => array( 3 ),
				)
			),
			self::group(
				array(
					self::week(
						array(
							'anchor'       => 'madrid',
							'categories'   => array( 4 ),
							'eventSources' => array( 'madrid-partners' ),
						)
					),
				)
			),
			self::week(
				array(
					'anchor'     => 'barcelona',
					'categories' => array( 5, 6 ),
				)
			),
		);

		$this->assertSame(
			array(
				'status'     => WeeklySummarySelection::FOUND,
				'attributes' => array(
					'categories'   => array( 3 ),
					'eventSources' => array(),
				),
			),
			WeeklySummarySelection::find( $blocks, 'valencia', self::no_patterns() )
		);
		$this->assertSame(
			array(
				'categories'   => array( 4 ),
				'eventSources' => array( 'madrid-partners' ),
			),
			WeeklySummarySelection::find( $blocks, 'madrid', self::no_patterns() )['attributes']
		);
		$this->assertSame(
			array(
				'categories'   => array( 5, 6 ),
				'eventSources' => array(),
			),
			WeeklySummarySelection::find( $blocks, 'barcelona', self::no_patterns() )['attributes']
		);
	}

	/**
	 * Blocks inside container blocks are found.
	 */
	public function test_finds_a_block_nested_in_containers() {
		$blocks = array(
			self::group(
				array(
					self::group(
						array(
							self::week(
								array(
									'anchor'     => 'community-week',
									'categories' => array( 7 ),
								)
							),
						)
					),
				)
			),
		);

		$result = WeeklySummarySelection::find( $blocks, 'community-week', self::no_patterns() );

		$this->assertSame( WeeklySummarySelection::FOUND, $result['status'] );
		$this->assertSame( array( 7 ), $result['attributes']['categories'] );
	}

	/**
	 * Blocks inside nested synced patterns are found.
	 */
	public function test_finds_a_block_inside_nested_synced_patterns() {
		$patterns = array(
			10 => array( self::group( array( self::synced( 11 ) ) ) ),
			11 => array(
				self::week(
					array(
						'anchor'       => 'community-week',
						'eventSources' => array( 'feed' ),
					)
				),
			),
		);

		$result = WeeklySummarySelection::find(
			array( self::synced( 10 ) ),
			'community-week',
			static fn( $ref ) => $patterns[ $ref ] ?? null
		);

		$this->assertSame( WeeklySummarySelection::FOUND, $result['status'] );
		$this->assertSame( array( 'feed' ), $result['attributes']['eventSources'] );
	}

	/**
	 * A synced pattern cycle is followed only once.
	 */
	public function test_a_synced_pattern_that_includes_itself_does_not_loop() {
		$calls  = 0;
		$result = WeeklySummarySelection::find(
			array( self::synced( 20 ) ),
			'community-week',
			static function ( $ref ) use ( &$calls ) {
				++$calls;
				return array( self::synced( 21 === $ref ? 20 : 21 ) );
			}
		);

		$this->assertSame( WeeklySummarySelection::NOT_FOUND, $result['status'] );
		$this->assertSame( 2, $calls );
	}

	/**
	 * A synced pattern that can't be shown is skipped.
	 */
	public function test_an_unavailable_synced_pattern_is_skipped() {
		$result = WeeklySummarySelection::find(
			array( self::synced( 30 ) ),
			'community-week',
			self::no_patterns()
		);

		$this->assertSame( WeeklySummarySelection::NOT_FOUND, $result['status'] );
	}

	/**
	 * Two blocks with one anchor are ambiguous.
	 */
	public function test_a_repeated_anchor_is_ambiguous() {
		$blocks = array(
			self::week(
				array(
					'anchor'     => 'community-week',
					'categories' => array( 1 ),
				)
			),
			self::group(
				array(
					self::week(
						array(
							'anchor'     => 'community-week',
							'categories' => array( 2 ),
						)
					),
				)
			),
		);

		$this->assertSame(
			array( 'status' => WeeklySummarySelection::AMBIGUOUS ),
			WeeklySummarySelection::find( $blocks, 'community-week', self::no_patterns() )
		);
	}

	/**
	 * A synced pattern shown twice repeats its anchor.
	 */
	public function test_a_synced_pattern_used_twice_is_ambiguous() {
		$result = WeeklySummarySelection::find(
			array( self::synced( 40 ), self::synced( 40 ) ),
			'community-week',
			static fn() => array( self::week( array( 'anchor' => 'community-week' ) ) )
		);

		$this->assertSame( WeeklySummarySelection::AMBIGUOUS, $result['status'] );
	}

	/**
	 * A missing anchor never resolves to another block.
	 */
	public function test_never_falls_back_to_another_calendar() {
		$blocks = array(
			self::week(
				array(
					'anchor'     => 'valencia',
					'categories' => array( 1 ),
				)
			),
			self::week( array( 'categories' => array( 2 ) ) ),
			array(
				'blockName'   => 'fair-events/events-calendar',
				'attrs'       => array( 'anchor' => 'madrid' ),
				'innerBlocks' => array(),
			),
		);

		$this->assertSame(
			array( 'status' => WeeklySummarySelection::NOT_FOUND ),
			WeeklySummarySelection::find( $blocks, 'madrid', self::no_patterns() )
		);
	}

	/**
	 * A calendar showing drafts can't back a public link.
	 */
	public function test_a_calendar_showing_drafts_cannot_back_a_link() {
		$blocks = array(
			self::week(
				array(
					'anchor'     => 'community-week',
					'showDrafts' => true,
				)
			),
		);

		$this->assertSame(
			array( 'status' => WeeklySummarySelection::SHOWS_DRAFTS ),
			WeeklySummarySelection::find( $blocks, 'community-week', self::no_patterns() )
		);
	}

	/**
	 * Default attributes select every event.
	 */
	public function test_block_defaults_mean_every_event() {
		$result = WeeklySummarySelection::find(
			array( self::week( array( 'anchor' => 'all' ) ) ),
			'all',
			self::no_patterns()
		);

		$this->assertSame(
			array(
				'categories'   => array(),
				'eventSources' => array(),
			),
			$result['attributes']
		);
	}

	/**
	 * Anchors a link may carry.
	 *
	 * @return array<string, array{0: mixed, 1: bool}>
	 */
	public static function anchors() {
		return array(
			'plain'        => array( 'community-week', true ),
			'mixed'        => array( 'Valencia_2:a.b', true ),
			'empty'        => array( '', false ),
			'space'        => array( 'community week', false ),
			'markup'       => array( '<script>', false ),
			'too long'     => array( str_repeat( 'a', 101 ), false ),
			'not a string' => array( array( 'a' ), false ),
		);
	}

	/**
	 * Anchor validation.
	 *
	 * @param mixed $anchor   Anchor.
	 * @param bool  $expected Whether it is valid.
	 */
	#[DataProvider( 'anchors' )]
	public function test_anchor_validation( $anchor, $expected ) {
		$this->assertSame( $expected, WeeklySummarySelection::is_valid_anchor( $anchor ) );
	}
}
