<?php
/**
 * SignupFieldsetRenderer tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\SignupFieldsetRenderer;
use PHPUnit\Framework\TestCase;

/**
 * Covers sale-period supporting text in the ticket fieldset.
 */
class SignupFieldsetRendererTest extends TestCase {

	/**
	 * Render one simple ticket type with the supplied period context.
	 *
	 * @param object|null $period Active sale period.
	 * @param int         $count  Configured period count.
	 * @return string
	 */
	private function render( $period, $count ) {
		$type = (object) array(
			'id'                 => 7,
			'name'               => 'General admission',
			'recurrence_scope'   => 'single_instance',
			'minimum_instances'  => 0,
			'minimum_activities' => 0,
		);

		return SignupFieldsetRenderer::ticket_type_fieldset(
			array( $type ),
			array(),
			$period,
			$count,
			false,
			false,
			'test-form'
		);
	}

	/** Multiple periods show the active name before the ticket options. */
	public function test_multiple_periods_show_active_period_name_before_options() {
		$html = $this->render( (object) array( 'name' => 'Early bird' ), 2 );

		$this->assertStringContainsString( 'You’re seeing Early bird prices.', $html );
		$this->assertLessThan( strpos( $html, 'General admission' ), strpos( $html, 'You’re seeing' ) );
	}

	/** The displayed name comes directly from the active pricing period. */
	public function test_displayed_name_comes_from_active_period_used_by_price_context() {
		$active_period = (object) array(
			'id'   => 22,
			'name' => 'Regular',
		);

		$this->assertStringContainsString( 'You’re seeing Regular prices.', $this->render( $active_period, 3 ) );
	}

	/** A single configured period needs no redundant context. */
	public function test_single_period_does_not_show_supporting_text() {
		$html = $this->render( (object) array( 'name' => 'Regular' ), 1 );

		$this->assertStringNotContainsString( 'fair-events-sale-period-context', $html );
	}

	/** No active period leaves the existing fieldset markup unchanged. */
	public function test_no_active_period_does_not_show_supporting_text() {
		$html = $this->render( null, 2 );

		$this->assertStringNotContainsString( 'fair-events-sale-period-context', $html );
		$this->assertStringContainsString( 'General admission', $html );
	}

	/** Organizer-defined markup is escaped. */
	public function test_period_name_is_escaped() {
		$html = $this->render( (object) array( 'name' => '<em>Early & eager</em>' ), 2 );

		$this->assertStringContainsString( '&lt;em&gt;Early &amp; eager&lt;/em&gt;', $html );
		$this->assertStringNotContainsString( '<em>', $html );
	}

	/** Long organizer-defined names remain intact for CSS wrapping. */
	public function test_long_period_name_remains_intact() {
		$name = 'A deliberately long organizer-defined sale period name that must remain readable';

		$this->assertStringContainsString( $name, $this->render( (object) array( 'name' => $name ), 2 ) );
	}

	/** Empty fieldsets render nothing, including no supporting text. */
	public function test_empty_ticket_type_fieldset_does_not_render_context() {
		$html = SignupFieldsetRenderer::ticket_type_fieldset(
			array(),
			array(),
			(object) array( 'name' => 'Early bird' ),
			2,
			false,
			false,
			'test-form'
		);

		$this->assertSame( '', $html );
	}
	/**
	 * Render the three series ticket scopes, each priced.
	 *
	 * @param bool $is_series Whether the form offers series dates.
	 * @return string
	 */
	private function render_series( $is_series ) {
		$types = array();
		foreach ( array(
			1 => 'single_instance',
			2 => 'multiple_instances',
			3 => 'whole_series',
		) as $id => $scope ) {
			$types[] = (object) array(
				'id'                 => $id,
				'name'               => 'Ticket ' . $id . ' & co',
				'recurrence_scope'   => $scope,
				'minimum_instances'  => 0,
				'minimum_activities' => 0,
			);
		}

		return SignupFieldsetRenderer::ticket_type_fieldset(
			$types,
			array(
				1 => 12.0,
				2 => 10.0,
				3 => 40.0,
			),
			null,
			1,
			true,
			false,
			'test-form',
			$is_series
		);
	}

	/** Each series ticket says what it covers and what its price is for. */
	public function test_series_tickets_explain_their_coverage_and_price() {
		$html = $this->render_series( true );

		$this->assertStringContainsString( 'One date', $html );
		$this->assertStringContainsString( 'Selected dates', $html );
		$this->assertStringContainsString( 'Whole series', $html );
		$this->assertSame( 2, substr_count( $html, ' per date' ) );
		$this->assertSame( 1, substr_count( $html, ' for the whole series' ) );
		$this->assertLessThan( strpos( $html, 'Selected dates' ), strpos( $html, 'One date' ) );
		$this->assertStringContainsString( 'data-ticket-name="Ticket 3 &amp; co"', $html );
		// The name is escaped once, not twice.
		$this->assertStringContainsString( '>Ticket 1 &amp; co<', $html );
	}

	/** A ticket outside a series keeps its name-and-price line. */
	public function test_non_series_tickets_keep_their_label() {
		$html = $this->render_series( false );

		$this->assertStringNotContainsString( 'fair-events-ticket-option-scope', $html );
		$this->assertStringNotContainsString( 'Whole series', $html );
		$this->assertStringNotContainsString( 'per date', $html );
	}
}
