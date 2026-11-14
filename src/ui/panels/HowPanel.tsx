import type { ReactNode } from 'react';
import { Section } from '@/ui/shell/Section';

function P({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[13px] leading-relaxed text-foreground/90 first:mt-0">{children}</p>;
}
function Limits({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
      <span className="font-medium text-foreground/80">Limits. </span>
      {children}
    </p>
  );
}

/** How each part is worked out, and where it stops being trustworthy. */
export function HowPanel() {
  return (
    <div>
      <div className="px-4 pt-3 pb-4">
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Everything measured here comes from NASA and USGS data. Everything worked out from it is called modelled, and this page says how.
        </p>
      </div>
      <Section id="how-ground" title="The ground" hint="Images and heights, and where they come from">
        <P>
          The picture of the ground is built from three orbiters: Viking for colour over the whole planet, THEMIS on Mars Odyssey and the Context Camera on
          Mars Reconnaissance Orbiter for detail down to about 6 m. Colour comes from Viking; the finer cameras see in black and white, so only their texture
          is used.
        </P>
        <P>
          Heights come from the MOLA laser altimeter, the HRSC and MOLA blended model at 200 m, and the Mars 2020 mission's own models of Jezero at 20 m and
          1 m. They are joined so there is no step where one takes over.
        </P>
        <Limits>Away from Jezero the finest detail is fetched live from NASA and USGS servers, so it needs a connection. HiRISE covers only strips of the surface.</Limits>
      </Section>
      <Section id="how-relief" title="Relief and light" hint="Why hills look steeper than they are">
        <P>
          Jezero is 45 km wide and about 500 m deep. Drawn to scale it looks flat, so the map stretches heights by up to three times. The chip at the bottom
          of the map always says by how much.
        </P>
        <P>The shading follows the real sun at Jezero for the time on the clock, and the map goes dark at night. Full daylight in the layers panel turns that off.</P>
      </Section>
      <Section id="how-routes" title="Routes" hint="How a route is found over real terrain">
        <P>
          A route is searched on a grid of heights, here about 20 m in the crater and 5 m near the rover's path. The search may cut across cells at any angle,
          so routes are not staircases. Ground steeper than the vehicle can climb is never crossed.
        </P>
        <P>
          Three styles are searched. Safest keeps away from steep, rough and cold ground and from radiation. Fastest only counts time. Eco counts effort: on
          foot that is the energy your body spends, on wheels the battery.
        </P>
        <P>When two styles follow the same ground they are shown as one card.</P>
        <Limits>The grid cannot see a rock or a sand trap smaller than its cells. Perseverance's real drive detours for hazards a metre across.</Limits>
      </Section>
      <Section id="how-vehicles" title="Vehicles and walking" hint="Speeds and limits">
        <P>
          Walking speed follows Tobler's hiking rule, capped at 3.3 km/h for a pressurised suit. The effort of walking follows the Pandolf load-carriage
          equation with a 75 kg person in a 45 kg suit, scaled for Mars gravity. Ten degrees uphill costs nearly twice the flat.
        </P>
        <Limits>Nobody has walked on Mars. These are Earth and Apollo figures scaled, and they are estimates.</Limits>
      </Section>
      <Section id="how-view" title="Rover View" hint="What is real and what is drawn in">
        <P>
          The shape of the ground is the real terrain model, at true scale. Its colour is the orbital image, shifted to the butterscotch tone the rovers'
          cameras record, because orbital colour looks too red from eye level.
        </P>
        <P>Rocks, sand ripples and rock layers smaller than the data are drawn in so the scene has scale. They are illustrative, not measured.</P>
        <P>The sky, the sun's position and the blue glow at sunset follow the hour and the dust in the air.</P>
      </Section>
      <Section id="how-time" title="Mars time" hint="Sols, seasons and the local clock">
        <P>
          Times are local true solar time at Jezero: noon is when the sun is highest. A sol is 24 h 39 min 35 s. Seasons are given as Ls, the angle of Mars
          around the Sun, where 0 is the start of northern spring. The method is the one NASA's Mars24 clock uses (Allison and McEwen, 2000).
        </P>
      </Section>
      <Section id="how-weather" title="Temperature, pressure and dust" hint="Modelled conditions">
        <P>Temperature is modelled from latitude, season, hour and height. Pressure starts from 560 Pa at the reference level and falls with height.</P>
        <P>
          Dust is given as optical depth, tau: about 0.4 on a clear day, above 2 in a regional storm, about 5 in a global one. The seasonal curve follows
          what the Mars rovers have recorded. The what-if controls on the clock let you test a plan against a storm.
        </P>
        <Limits>These are climate averages, not a forecast. The weather stations on Curiosity and Perseverance are shown where their feeds answer.</Limits>
      </Section>
      <Section id="how-radiation" title="Radiation" hint="Dose on the surface">
        <P>
          Curiosity's RAD instrument measures about 0.64 mSv per sol in Gale crater. That figure is scaled here by how much air is overhead: lower ground
          has more air above it and a little less dose. A solar particle event raises it for hours.
        </P>
        <Limits>Dose varies with the solar cycle and with shelter from nearby cliffs, which this model only approximates.</Limits>
      </Section>
      <Section id="how-geology" title="Geology and minerals" hint="The geologic map and the CRISM overlays">
        <P>The geologic map is the USGS map of the whole planet (Tanaka and others, 2014). Its units are tens of kilometres across.</P>
        <P>
          The mineral overlays are from CRISM, a spectrometer on Mars Reconnaissance Orbiter that reads minerals from the colours of reflected sunlight.
          Olivine and carbonate around Jezero's rim are a reason this crater was chosen for Perseverance.
        </P>
      </Section>
    </div>
  );
}
