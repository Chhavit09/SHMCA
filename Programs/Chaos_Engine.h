#pragma once
#include <vector>
#include <cstdlib>
#include <fstream>


inline bool chance(int percent)
{
    return (std::rand() % 100) < percent;
}

inline void runChaosEngine(std::vector<Satellite*> &sats, 
    std::vector<Debris> &debrisList,int &nextDebrisId,
    std::ofstream &logFile,double simTime){
    if(sats.empty()) 
        return;
    // OOP Unit 2: Pointers to objects
    Satellite *s = sats[std::rand() % sats.size()];

    if (chance(6) && !s->isDisabled()) {
        double sev = 15 + std::rand() % 30;
        s->hitBySolarFlare(sev);
        logFile << "[t=" << simTime << "s] [CHAOS] Solar flare on " << s->getName() << " software -" << sev << "\n";
    }
    if (chance(7) && !s->isDisabled()) {
        double amt = 3 + std::rand() % 8;
        s->hitByBatteryDrain(amt);
        logFile << "[t=" << simTime << "s] [CHAOS] Battery drain on " << s->getName() << " battery -" << amount << "\n";
    }
    if (chance(2) && !s->isDisabled() && s->isThrusterOk()) {
        s->hitByThrusterFailure();
        logFile << "[t=" << simTime << "s] [CHAOS] Thruster burnout on " << s->getName() << "\n";
    }
    if (chance(5) && !s->isDisabled()) {
        s->hitByProgramBug();
        logFile << "[t=" << simTime << "s] [CHAOS] Critical program bug in " << s->getName() << " code\n";
    }

    if (chance(3) && !s->isDisabled() && s->areSensorsOk()) {
        s->hitBySensorFault();
        logFile << "[t=" << simTime << "s] [CHAOS] Sensor hardware fault on " << s->getName() << "\n";
    }
    if (chance(25)) {
        Vector3 base = s->getPos();
        Vector3 spawnPos = base + Vector3((std::rand() % 90 - 45), (std::rand() % 90 - 45), (std::rand() % 90 - 45));
        
        Vector3 toSat = base - spawnPos;
        double mag = dist3D(base, spawnPos);
        
        Vector3 dir(0, 0, 1);
        if (mag > 0.001) {
            dir = toSat * (1.0 / mag);
        }
        Vector3 vel = s->getVel() + dir * (0.1 + (std::rand() % 20) / 100.0);
        
        Debris d; 
        d.id = nextDebrisId++; 
        d.pos = spawnPos; 
        d.vel = vel;
        debrisList.push_back(d);
        
        logFile << "[t=" << simTime << "s] [CHAOS] New debris #" << d.id << " near " << s->getName() << "\n";

        }
}

