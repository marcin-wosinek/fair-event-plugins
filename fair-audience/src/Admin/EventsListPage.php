<?php
/**
 * Events List Page
 *
 * @package FairAudience
 */

namespace FairAudience\Admin;

defined( 'WPINC' ) || die;

/**
 * Events List admin page.
 */
class EventsListPage {
	/**
	 * Render page.
	 */
	public function render() {
		?>
		<div id="fair-audience-events-list-root"></div>
		<?php
	}
}
